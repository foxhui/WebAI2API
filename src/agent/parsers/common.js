import { AgentError, AGENT_ERROR_CODES } from '../core/errors.js';
import { createCallId } from '../ir/ids.js';
import { stripLeadingReasoning, stripSingleMarkdownFence } from '../prompts/base.js';
import {
    normalizeArgumentsObject,
    parseToolArguments,
    validateToolArguments
} from '../core/validation.js';

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function repairJsonStringEscapes(value) {
    let repaired = '';
    let inString = false;

    for (let index = 0; index < value.length; index++) {
        const character = value[index];
        if (!inString) {
            repaired += character;
            if (character === '"') inString = true;
            continue;
        }

        if (character === '"') {
            repaired += character;
            inString = false;
            continue;
        }

        if (character === '\\') {
            const next = value[index + 1];
            if ('"\\/bfnrt'.includes(next || '')) {
                repaired += `\\${next}`;
                index++;
                continue;
            }
            if (next === 'u') {
                const hex = value.slice(index + 2, index + 6);
                if (/^[0-9a-f]{4}$/i.test(hex)) {
                    repaired += `\\u${hex}`;
                    index += 5;
                    continue;
                }
            }
            // Web models frequently emit a Windows path or a regex with an
            // unescaped backslash inside a JSON string. Preserve that literal
            // character by escaping only the offending slash; the parsed
            // payload still goes through the normal tool allowlist/schema checks.
            repaired += '\\\\';
            continue;
        }

        if (character === '\n') {
            repaired += '\\n';
        } else if (character === '\r') {
            repaired += '\\r';
        } else if (character === '\t') {
            repaired += '\\t';
        } else {
            repaired += character;
        }
    }

    return repaired;
}

function parsePayload(raw, label) {
    const trimmed = raw.trim();
    try {
        return JSON.parse(trimmed);
    } catch (error) {
        // Synthetic web output is not a native JSON transport. A common
        // provider defect is a valid envelope whose string argument contains
        // a Windows path/regex with an unescaped backslash or line break. Apply
        // a narrow, string-only repair before rejecting the tool call; schema
        // and declared-tool validation remain mandatory after parsing.
        const repaired = repairJsonStringEscapes(trimmed);
        if (repaired !== trimmed) {
            try {
                return JSON.parse(repaired);
            } catch {
                // Preserve the original parse diagnostic below.
            }
        }
        throw new AgentError(
            AGENT_ERROR_CODES.MALFORMED_TOOL_CALL,
            `${label} contains invalid JSON: ${error.message}`
        );
    }
}

export function parseTaggedJsonCalls(text, options) {
    const {
        openTag,
        closeTag,
        nonce,
        toolMap,
        parserId,
        payloadToCall,
        allowMissingNonce = true,
        allowReasoning = false
    } = options;
    const original = stripSingleMarkdownFence(text);
    const reasoningResult = allowReasoning ? stripLeadingReasoning(original) : { remaining: original };
    const source = reasoningResult.remaining;
    const openPattern = new RegExp(`<${escapeRegExp(openTag)}(?:\\s+nonce=["']([^"']+)["'])?\\s*>`, 'i');
    const closeLiteral = `</${closeTag}>`;
    const calls = [];
    let cursor = 0;

    while (cursor < source.length) {
        while (/\s/.test(source[cursor] || '')) cursor++;
        if (cursor >= source.length) break;
        const openMatch = source.slice(cursor).match(openPattern);
        if (!openMatch || openMatch.index !== 0) {
            if (source.slice(cursor).toLowerCase().includes(`<${openTag.toLowerCase()}`)) {
                throw new AgentError(
                    AGENT_ERROR_CODES.MALFORMED_TOOL_CALL,
                    `${parserId} found a malformed ${openTag} envelope`
                );
            }
            if (calls.length > 0) {
                throw new AgentError(
                    AGENT_ERROR_CODES.MALFORMED_TOOL_CALL,
                    `${parserId} found text outside a tool envelope`
                );
            }
            return {
                kind: 'final',
                text: source,
                reasoning: reasoningResult.reasoning
            };
        }

        const foundNonce = openMatch[1];
        if (foundNonce && nonce && foundNonce !== nonce) {
            throw new AgentError(
                AGENT_ERROR_CODES.TOOL_CALL_NONCE_MISMATCH,
                `${parserId} tool envelope nonce does not match this request`
            );
        }
        if (!foundNonce && !allowMissingNonce && nonce) {
            throw new AgentError(
                AGENT_ERROR_CODES.TOOL_CALL_NONCE_MISMATCH,
                `${parserId} tool envelope is missing its request nonce`
            );
        }

        const bodyStart = cursor + openMatch[0].length;
        const closeIndex = source.indexOf(closeLiteral, bodyStart);
        if (closeIndex === -1) {
            throw new AgentError(
                AGENT_ERROR_CODES.MALFORMED_TOOL_CALL,
                `${parserId} tool envelope is missing its closing tag`
            );
        }
        const payload = parsePayload(source.slice(bodyStart, closeIndex), `${parserId} tool call`);
        calls.push(payloadToCall(payload, { toolMap, nonce, parserId }));
        cursor = closeIndex + closeLiteral.length;
    }

    if (calls.length === 0) {
        return {
            kind: 'final',
            text: source,
            reasoning: reasoningResult.reasoning
        };
    }
    return { kind: 'tool_calls', calls, reasoning: reasoningResult.reasoning };
}

export function payloadToUniversalCall(payload, options = {}) {
    const { toolMap, parserId, generateCallIds = false } = options;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new AgentError(AGENT_ERROR_CODES.MALFORMED_TOOL_CALL, `${parserId} payload must be an object`);
    }
    const name = payload.name || payload.function?.name;
    if (typeof name !== 'string' || !name) {
        throw new AgentError(AGENT_ERROR_CODES.MALFORMED_TOOL_CALL, `${parserId} payload is missing tool name`);
    }
    const tool = toolMap.get(name);
    if (!tool) {
        throw new AgentError(AGENT_ERROR_CODES.UNKNOWN_TOOL, `${parserId} requested undeclared tool: ${name}`);
    }
    const rawArguments = payload.arguments ?? payload.args ?? payload.input ?? payload.function?.arguments ?? {};
    let argumentsObject;
    if (typeof rawArguments === 'string') {
        argumentsObject = parseToolArguments(rawArguments, { label: `${parserId} arguments` });
    } else {
        argumentsObject = normalizeArgumentsObject(rawArguments, { label: `${parserId} arguments` });
    }
    argumentsObject = validateToolArguments(tool, argumentsObject);
    // Synthetic web-model envelopes are untrusted text, not a provider-owned
    // protocol object. Assign their IDs at the compatibility boundary so a
    // model repeating an example placeholder cannot collide across turns.
    // Native pass-through keeps the provider ID because it may be required by
    // provider-side state and opaque continuation data.
    const callId = generateCallIds
        ? createCallId()
        : (payload.call_id || payload.callId || payload.id || createCallId());
    if (typeof callId !== 'string' || !callId) {
        throw new AgentError(AGENT_ERROR_CODES.MALFORMED_TOOL_CALL, `${parserId} call ID is invalid`);
    }
    return {
        type: 'tool_call',
        id: typeof payload.item_id === 'string' ? payload.item_id : undefined,
        callId,
        name,
        arguments: argumentsObject,
        rawArguments: typeof rawArguments === 'string' ? rawArguments : JSON.stringify(argumentsObject),
        status: 'completed'
    };
}

export function outputToAssistantTurn(parsed, options = {}) {
    if (parsed.kind === 'final') {
        return {
            items: [{
                type: 'message',
                role: 'assistant',
                content: [{ type: 'text', text: parsed.text }]
            }],
            reasoning: parsed.reasoning
        };
    }
    return {
        items: parsed.calls,
        reasoning: parsed.reasoning
    };
}
