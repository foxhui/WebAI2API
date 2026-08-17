export const AGENT_PROTOCOLS = Object.freeze({
    OPENAI_CHAT: 'openai_chat',
    OPENAI_RESPONSES: 'openai_responses'
});

export const AGENT_ITEM_TYPES = Object.freeze({
    MESSAGE: 'message',
    TOOL_CALL: 'tool_call',
    TOOL_RESULT: 'tool_result',
    REASONING: 'reasoning'
});

export const TOOL_CHOICE_MODES = Object.freeze({
    AUTO: 'auto',
    NONE: 'none',
    REQUIRED: 'required',
    FUNCTION: 'function'
});

export function isAgentRequest(value) {
    return Boolean(
        value &&
        typeof value === 'object' &&
        Object.values(AGENT_PROTOCOLS).includes(value.protocol) &&
        typeof value.requestId === 'string' &&
        typeof value.model === 'string' &&
        Array.isArray(value.instructions) &&
        Array.isArray(value.items) &&
        Array.isArray(value.tools)
    );
}
