import { AgentError, AGENT_ERROR_CODES } from '../../core/errors.js';
import { assertConversationReadyForModel, analyzeConversation } from '../../core/state-machine.js';
import {
    normalizeArgumentsObject,
    normalizeToolDefinitions,
    parseToolArguments,
    validateToolResultSize
} from '../../core/validation.js';
import { normalizeContentParts, normalizeToolOutput } from '../../ir/content-parts.js';
import { createAgentRequest, normalizeToolChoice } from '../../ir/normalize.js';
import { AGENT_PROTOCOLS } from '../../ir/schema.js';
import { assertSupportedTextModel } from '../model.js';

function normalizeInstructions(rawInstructions, field = 'instructions') {
    if (rawInstructions === undefined || rawInstructions === null) return [];
    if (typeof rawInstructions === 'string') {
        return [{ type: 'instruction', role: 'system', content: [{ type: 'text', text: rawInstructions }] }];
    }
    if (!Array.isArray(rawInstructions)) {
        throw new AgentError(AGENT_ERROR_CODES.INVALID_REQUEST, `${field} must be a string or array`);
    }

    return rawInstructions.map((instruction, index) => {
        if (typeof instruction === 'string') {
            return {
                type: 'instruction',
                role: 'system',
                content: [{ type: 'text', text: instruction }]
            };
        }
        if (!instruction || typeof instruction !== 'object') {
            throw new AgentError(
                AGENT_ERROR_CODES.INVALID_REQUEST,
                `${field}[${index}] must be an instruction object`
            );
        }
        return {
            type: 'instruction',
            role: instruction.role === 'developer' ? 'developer' : 'system',
            content: normalizeContentParts(instruction.content ?? instruction.text, {
                field: `${field}[${index}]`
            })
        };
    });
}

function normalizeResponseMessage(item, index) {
    const role = item.role;
    if (!['user', 'assistant', 'system', 'developer'].includes(role)) {
        throw new AgentError(
            AGENT_ERROR_CODES.INVALID_REQUEST,
            `input[${index}] has unsupported message role: ${role || 'unknown'}`
        );
    }
    const content = normalizeContentParts(item.content ?? item.text, {
        field: `input[${index}].content`
    });
    if (role === 'system' || role === 'developer') {
        return {
            type: 'instruction',
            role,
            content
        };
    }
    return {
        type: 'message',
        id: typeof item.id === 'string' ? item.id : undefined,
        role,
        content
    };
}

function normalizeFunctionCall(item, index) {
    const callId = item.call_id || item.callId;
    if (!callId || typeof callId !== 'string') {
        throw new AgentError(
            AGENT_ERROR_CODES.INVALID_REQUEST,
            `input[${index}] function_call is missing call_id`
        );
    }
    if (!item.name || typeof item.name !== 'string') {
        throw new AgentError(
            AGENT_ERROR_CODES.INVALID_REQUEST,
            `input[${index}] function_call is missing name`
        );
    }
    const rawArguments = item.arguments;
    const argumentsObject = typeof rawArguments === 'string'
        ? parseToolArguments(rawArguments, { label: `Arguments for historical call ${callId}` })
        : normalizeArgumentsObject(rawArguments || {}, { label: `Arguments for historical call ${callId}` });
    return {
        type: 'tool_call',
        id: typeof item.id === 'string' ? item.id : undefined,
        callId,
        name: item.name,
        arguments: argumentsObject,
        rawArguments: typeof rawArguments === 'string' ? rawArguments : JSON.stringify(argumentsObject),
        status: item.status || 'completed'
    };
}

function normalizeFunctionCallOutput(item, index) {
    const callId = item.call_id || item.callId;
    if (!callId || typeof callId !== 'string') {
        throw new AgentError(
            AGENT_ERROR_CODES.INVALID_REQUEST,
            `input[${index}] function_call_output is missing call_id`
        );
    }
    const output = normalizeToolOutput(item.output, `input[${index}].output`);
    validateToolResultSize(output);
    return {
        type: 'tool_result',
        role: 'tool',
        id: typeof item.id === 'string' ? item.id : undefined,
        callId,
        name: typeof item.name === 'string' ? item.name : undefined,
        output,
        isError: item.is_error === true || item.isError === true
    };
}

function normalizeReasoning(item, index) {
    let summary = item.summary;
    if (Array.isArray(summary)) {
        summary = summary.map(part => part?.text || '').join('');
    }
    if (summary !== undefined && typeof summary !== 'string') {
        throw new AgentError(AGENT_ERROR_CODES.INVALID_REQUEST, `input[${index}].summary is invalid`);
    }
    return {
        type: 'reasoning',
        id: typeof item.id === 'string' ? item.id : undefined,
        summary: summary || undefined,
        opaqueState: item.encrypted_content ? { encrypted_content: item.encrypted_content } : undefined
    };
}

function normalizeInputItems(input) {
    if (input === undefined || input === null) {
        throw new AgentError(AGENT_ERROR_CODES.INVALID_REQUEST, 'input is required');
    }
    if (typeof input === 'string') {
        return [{
            type: 'message',
            role: 'user',
            content: [{ type: 'text', text: input }]
        }];
    }
    if (!Array.isArray(input)) {
        throw new AgentError(AGENT_ERROR_CODES.INVALID_REQUEST, 'input must be a string or array');
    }

    const items = [];
    input.forEach((item, index) => {
        if (!item || typeof item !== 'object') {
            throw new AgentError(AGENT_ERROR_CODES.INVALID_REQUEST, `input[${index}] must be an object`);
        }
        switch (item.type) {
            case 'message':
                items.push(normalizeResponseMessage(item, index));
                break;
            case 'function_call':
                items.push(normalizeFunctionCall(item, index));
                break;
            case 'function_call_output':
                items.push(normalizeFunctionCallOutput(item, index));
                break;
            case 'reasoning':
                items.push(normalizeReasoning(item, index));
                break;
            default:
                if (item.role) {
                    items.push(normalizeResponseMessage(item, index));
                    break;
                }
                throw new AgentError(
                    AGENT_ERROR_CODES.INVALID_REQUEST,
                    `Unsupported Responses input item type: ${item.type || 'unknown'}`
                );
        }
    });
    return items;
}

function mergeInstructions(previous, current) {
    if (current.length === 0) return previous || [];
    return current;
}

export function normalizeOpenAIResponsesRequest(data, options) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new AgentError(AGENT_ERROR_CODES.INVALID_REQUEST, 'Request body must be a JSON object');
    }

    let previousState = null;
    if (data.previous_response_id) {
        if (!options.conversationStore) {
            throw new AgentError(AGENT_ERROR_CODES.RESPONSE_NOT_FOUND, 'Responses state storage is unavailable');
        }
        previousState = options.conversationStore.get(data.previous_response_id);
    }

    const model = data.model || previousState?.model;
    assertSupportedTextModel(model, options);
    if (previousState && previousState.model !== model) {
        throw new AgentError(
            AGENT_ERROR_CODES.RESPONSE_MODEL_MISMATCH,
            `previous_response_id belongs to model ${previousState.model}, not ${model}`
        );
    }

    const tools = data.tools === undefined
        ? (previousState?.tools || [])
        : normalizeToolDefinitions(data.tools, { ignoreUnsupportedBuiltinTools: true });
    const toolChoice = data.tool_choice === undefined
        ? (previousState?.toolChoice || { mode: 'auto' })
        : normalizeToolChoice(data.tool_choice);
    if (toolChoice.mode === 'function' && !tools.some(tool => tool.name === toolChoice.name)) {
        throw new AgentError(
            AGENT_ERROR_CODES.UNKNOWN_TOOL,
            `tool_choice references undeclared tool: ${toolChoice.name}`
        );
    }

    const currentInstructions = normalizeInstructions(data.instructions);
    const instructions = mergeInstructions(previousState?.instructions, currentInstructions);
    const incomingItems = normalizeInputItems(data.input);
    const items = [...(previousState?.items || []), ...incomingItems];

    // Instructions entered through input are retained as instructions rather than silently dropped.
    const inputInstructions = items.filter(item => item.type === 'instruction');
    const conversationItems = items.filter(item => item.type !== 'instruction');
    const allInstructions = [...instructions, ...inputInstructions];

    analyzeConversation(conversationItems, tools);
    assertConversationReadyForModel({ items: conversationItems, tools });

    return createAgentRequest({
        requestId: options.requestId,
        protocol: AGENT_PROTOCOLS.OPENAI_RESPONSES,
        model,
        instructions: allInstructions,
        items: conversationItems,
        tools,
        toolChoice,
        parallelToolCalls: data.parallel_tool_calls === undefined
            ? (previousState?.parallelToolCalls === true)
            : data.parallel_tool_calls === true,
        stream: data.stream === true,
        metadata: {
            route: '/v1/responses',
            previousResponseId: data.previous_response_id || null,
            expectedExecution: previousState?.execution || null,
            storeRequested: data.store !== false
        }
    });
}
