import { AgentError, AGENT_ERROR_CODES } from '../../core/errors.js';
import { analyzeConversation } from '../../core/state-machine.js';
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

export function isOpenAIChatAgentRequest(data) {
    return Boolean(
        (Array.isArray(data?.tools) && data.tools.length > 0) ||
        data?.tool_choice !== undefined ||
        data?.parallel_tool_calls !== undefined ||
        data?.messages?.some(message => (
            message?.role === 'tool' ||
            (message?.role === 'assistant' && Array.isArray(message.tool_calls))
        ))
    );
}

function normalizeInstruction(message, index) {
    return {
        type: 'instruction',
        role: message.role,
        content: normalizeContentParts(message.content, {
            field: `messages[${index}].content`
        })
    };
}

function normalizeAssistantToolCall(toolCall, messageIndex, callIndex) {
    if (!toolCall || toolCall.type !== 'function' || !toolCall.function) {
        throw new AgentError(
            AGENT_ERROR_CODES.UNSUPPORTED_TOOL_TYPE,
            `messages[${messageIndex}].tool_calls[${callIndex}] must be a function call`
        );
    }
    if (!toolCall.id || typeof toolCall.id !== 'string') {
        throw new AgentError(
            AGENT_ERROR_CODES.INVALID_REQUEST,
            `messages[${messageIndex}].tool_calls[${callIndex}] is missing id`
        );
    }
    if (!toolCall.function.name || typeof toolCall.function.name !== 'string') {
        throw new AgentError(
            AGENT_ERROR_CODES.INVALID_REQUEST,
            `messages[${messageIndex}].tool_calls[${callIndex}] is missing function.name`
        );
    }

    const rawArguments = toolCall.function.arguments;
    const argumentsObject = typeof rawArguments === 'string'
        ? parseToolArguments(rawArguments, {
            label: `Arguments for historical call ${toolCall.id}`
        })
        : normalizeArgumentsObject(rawArguments || {}, {
            label: `Arguments for historical call ${toolCall.id}`
        });
    return {
        type: 'tool_call',
        id: toolCall.id,
        callId: toolCall.id,
        name: toolCall.function.name,
        arguments: argumentsObject,
        rawArguments: typeof rawArguments === 'string' ? rawArguments : JSON.stringify(argumentsObject),
        status: 'completed'
    };
}

export function normalizeOpenAIChatRequest(data, options) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new AgentError(AGENT_ERROR_CODES.INVALID_REQUEST, 'Request body must be a JSON object');
    }
    if (!Array.isArray(data.messages) || data.messages.length === 0) {
        throw new AgentError(AGENT_ERROR_CODES.INVALID_REQUEST, 'messages must be a non-empty array');
    }

    const model = assertSupportedTextModel(data.model, options);
    const tools = normalizeToolDefinitions(data.tools || [], { ignoreUnsupportedBuiltinTools: true });
    const toolChoice = normalizeToolChoice(data.tool_choice);
    if (toolChoice.mode !== 'none' && tools.length === 0) {
        throw new AgentError(
            AGENT_ERROR_CODES.INVALID_TOOL_DEFINITION,
            'At least one function tool is required unless tool_choice is none'
        );
    }
    if (toolChoice.mode === 'function' && !tools.some(tool => tool.name === toolChoice.name)) {
        throw new AgentError(
            AGENT_ERROR_CODES.UNKNOWN_TOOL,
            `tool_choice references undeclared tool: ${toolChoice.name}`
        );
    }

    const instructions = [];
    const items = [];
    for (let index = 0; index < data.messages.length; index++) {
        const message = data.messages[index];
        if (!message || typeof message !== 'object') {
            throw new AgentError(
                AGENT_ERROR_CODES.INVALID_REQUEST,
                `messages[${index}] must be an object`
            );
        }

        if (message.role === 'system' || message.role === 'developer') {
            instructions.push(normalizeInstruction(message, index));
            continue;
        }

        if (message.role === 'user') {
            items.push({
                type: 'message',
                role: 'user',
                content: normalizeContentParts(message.content, {
                    field: `messages[${index}].content`
                })
            });
            continue;
        }

        if (message.role === 'assistant') {
            const content = normalizeContentParts(message.content, {
                field: `messages[${index}].content`
            });
            if (content.length > 0) {
                items.push({
                    type: 'message',
                    role: 'assistant',
                    content
                });
            }
            if (message.reasoning_content) {
                items.push({
                    type: 'reasoning',
                    summary: String(message.reasoning_content)
                });
            }
            if (message.tool_calls !== undefined && !Array.isArray(message.tool_calls)) {
                throw new AgentError(
                    AGENT_ERROR_CODES.INVALID_REQUEST,
                    `messages[${index}].tool_calls must be an array`
                );
            }
            for (let callIndex = 0; callIndex < (message.tool_calls || []).length; callIndex++) {
                items.push(normalizeAssistantToolCall(message.tool_calls[callIndex], index, callIndex));
            }
            continue;
        }

        if (message.role === 'tool') {
            if (!message.tool_call_id || typeof message.tool_call_id !== 'string') {
                throw new AgentError(
                    AGENT_ERROR_CODES.INVALID_REQUEST,
                    `messages[${index}] is missing tool_call_id`
                );
            }
            const output = normalizeToolOutput(message.content, `messages[${index}].content`);
            validateToolResultSize(output);
            items.push({
                type: 'tool_result',
                role: 'tool',
                callId: message.tool_call_id,
                name: typeof message.name === 'string' ? message.name : undefined,
                output,
                isError: message.is_error === true || message.isError === true
            });
            continue;
        }

        throw new AgentError(
            AGENT_ERROR_CODES.INVALID_REQUEST,
            `Unsupported message role at messages[${index}]: ${message.role || 'unknown'}`
        );
    }

    analyzeConversation(items, tools);

    return createAgentRequest({
        requestId: options.requestId,
        protocol: AGENT_PROTOCOLS.OPENAI_CHAT,
        model,
        instructions,
        items,
        tools,
        toolChoice,
        parallelToolCalls: data.parallel_tool_calls === true,
        stream: data.stream === true,
        metadata: {
            route: '/v1/chat/completions',
            reasoning: data.reasoning === true
        }
    });
}
