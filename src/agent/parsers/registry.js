import { AgentError, AGENT_ERROR_CODES } from '../core/errors.js';
import { outputToAssistantTurn, parseTaggedJsonCalls, payloadToUniversalCall } from './common.js';

function createTaggedParser({ id, openTag, closeTag, allowReasoning = false }) {
    return {
        id,
        parse(text, context) {
            const parsed = parseTaggedJsonCalls(text, {
                openTag,
                closeTag,
                nonce: context.nonce,
                toolMap: context.toolMap,
                parserId: id,
                allowReasoning,
                payloadToCall: payload => payloadToUniversalCall(payload, { ...context, parserId: id })
            });
            return outputToAssistantTurn(parsed);
        }
    };
}

const openAIStyleParser = createTaggedParser({
    id: 'openai_style_synthetic',
    openTag: 'agent_tool_call',
    closeTag: 'agent_tool_call'
});

const genericTaggedParser = createTaggedParser({
    id: 'generic_tagged_json',
    openTag: 'tool_call',
    closeTag: 'tool_call'
});

const hermesParser = createTaggedParser({
    id: 'qwen_hermes',
    openTag: 'tool_call',
    closeTag: 'tool_call',
    allowReasoning: true
});

function parseQwen3Coder(text, context) {
    try {
        const parsed = parseTaggedJsonCalls(text, {
            openTag: 'tool_call',
            closeTag: 'tool_call',
            nonce: context.nonce,
            toolMap: context.toolMap,
            parserId: 'qwen3_coder',
            allowReasoning: true,
            payloadToCall: payload => payloadToUniversalCall(payload, { ...context, parserId: 'qwen3_coder' })
        });
        if (parsed.kind === 'tool_calls' || parsed.text !== text) return outputToAssistantTurn(parsed);
    } catch (error) {
        // Try the official Qwen3-Coder parameter-tag form once before returning the typed error.
        if (error.code !== AGENT_ERROR_CODES.MALFORMED_TOOL_CALL) throw error;
    }

    const source = String(text ?? '').trim();
    const calls = [];
    let cursor = 0;
    const outer = /<tool_call\s*>([\s\S]*?)<\/tool_call>/gi;
    let match;
    while ((match = outer.exec(source))) {
        if (source.slice(cursor, match.index).trim()) {
            throw new AgentError(AGENT_ERROR_CODES.MALFORMED_TOOL_CALL, 'qwen3_coder text outside tool_call envelope');
        }
        const body = match[1].trim();
        const fnMatch = body.match(/^<function=([^>]+)>\s*([\s\S]*?)<\/function>$/i);
        if (!fnMatch) throw new AgentError(AGENT_ERROR_CODES.MALFORMED_TOOL_CALL, 'qwen3_coder function envelope is malformed');
        const name = fnMatch[1].trim();
        const tool = context.toolMap.get(name);
        if (!tool) throw new AgentError(AGENT_ERROR_CODES.UNKNOWN_TOOL, `qwen3_coder requested undeclared tool: ${name}`);
        const parameters = {};
        const parameterPattern = /<parameter=([^>]+)>\s*([\s\S]*?)<\/parameter>/gi;
        let parameterMatch;
        let parameterCount = 0;
        while ((parameterMatch = parameterPattern.exec(fnMatch[2]))) {
            parameters[parameterMatch[1].trim()] = parameterMatch[2].trim();
            parameterCount++;
        }
        if (parameterCount === 0 && fnMatch[2].trim()) {
            throw new AgentError(AGENT_ERROR_CODES.MALFORMED_TOOL_CALL, 'qwen3_coder parameters are malformed');
        }
        calls.push(payloadToUniversalCall({ name, arguments: parameters }, { ...context, parserId: 'qwen3_coder' }));
        cursor = outer.lastIndex;
    }
    if (calls.length === 0) {
        return outputToAssistantTurn({ kind: 'final', text: source });
    }
    if (source.slice(cursor).trim()) {
        throw new AgentError(AGENT_ERROR_CODES.MALFORMED_TOOL_CALL, 'qwen3_coder text after tool_call envelope');
    }
    return outputToAssistantTurn({ kind: 'tool_calls', calls });
}

const geminiParser = createTaggedParser({
    id: 'gemini_synthetic',
    openTag: 'gemini_function_call',
    closeTag: 'gemini_function_call'
});

const anthropicParser = {
    id: 'anthropic_synthetic',
    parse(text, context) {
        const parsed = parseTaggedJsonCalls(text, {
            openTag: 'tool_use',
            closeTag: 'tool_use',
            nonce: context.nonce,
            toolMap: context.toolMap,
            parserId: 'anthropic_synthetic',
            payloadToCall: payload => payloadToUniversalCall({
                ...payload,
                arguments: payload.input,
                call_id: payload.id
            }, { ...context, parserId: 'anthropic_synthetic' })
        });
        return outputToAssistantTurn(parsed);
    }
};

function parseNativeToolCalls(value, context) {
    const message = value?.choices?.[0]?.message || value?.message || value;
    const rawCalls = message?.tool_calls || message?.function_call;
    if (!rawCalls) {
        const text = typeof message?.content === 'string' ? message.content : String(value?.text || '');
        return outputToAssistantTurn({ kind: 'final', text });
    }
    const calls = Array.isArray(rawCalls) ? rawCalls : [rawCalls];
    return outputToAssistantTurn({
        kind: 'tool_calls',
        calls: calls.map(call => payloadToUniversalCall(call, { ...context, parserId: 'zenmux_native' }))
    });
}

const nativeParser = {
    id: 'zenmux_native',
    parse(value, context) {
        if (typeof value === 'string') {
            try {
                return parseNativeToolCalls(JSON.parse(value), context);
            } catch (error) {
                if (error instanceof SyntaxError) {
                    return outputToAssistantTurn({ kind: 'final', text: value });
                }
                throw error;
            }
        }
        return parseNativeToolCalls(value, context);
    }
};

const parsers = new Map([
    [openAIStyleParser.id, openAIStyleParser],
    [genericTaggedParser.id, genericTaggedParser],
    [hermesParser.id, hermesParser],
    ['qwen3_coder', { id: 'qwen3_coder', parse: parseQwen3Coder }],
    [geminiParser.id, geminiParser],
    [anthropicParser.id, anthropicParser],
    [nativeParser.id, nativeParser],
    ['no_tool', { id: 'no_tool', parse: text => outputToAssistantTurn({ kind: 'final', text: String(text ?? '') }) }]
]);

export function getToolParser(parserId) {
    return parsers.get(parserId) || null;
}

export function listToolParsers() {
    return [...parsers.keys()];
}

export function parseToolOutput(parserId, output, context = {}) {
    const parser = getToolParser(parserId);
    if (!parser) {
        throw new AgentError(AGENT_ERROR_CODES.PROVIDER_PARSE_FAILED, `Unknown tool parser: ${parserId}`);
    }
    return parser.parse(output, context);
}
