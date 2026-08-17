export const AGENT_ERROR_CODES = Object.freeze({
    FEATURE_DISABLED: 'AGENT_COMPATIBILITY_DISABLED',
    INVALID_REQUEST: 'AGENT_INVALID_REQUEST',
    INVALID_MODEL: 'AGENT_INVALID_MODEL',
    UNSUPPORTED_CONTENT: 'AGENT_UNSUPPORTED_CONTENT',
    UNSUPPORTED_TOOL_TYPE: 'AGENT_UNSUPPORTED_TOOL_TYPE',
    UNSUPPORTED_BUILTIN_TOOL: 'AGENT_UNSUPPORTED_BUILTIN_TOOL',
    INVALID_TOOL_DEFINITION: 'AGENT_INVALID_TOOL_DEFINITION',
    INVALID_TOOL_SCHEMA: 'AGENT_INVALID_TOOL_SCHEMA',
    INVALID_TOOL_ARGUMENTS: 'AGENT_INVALID_TOOL_ARGUMENTS',
    UNKNOWN_TOOL: 'AGENT_UNKNOWN_TOOL',
    DUPLICATE_CALL_ID: 'AGENT_DUPLICATE_CALL_ID',
    ORPHAN_TOOL_RESULT: 'AGENT_ORPHAN_TOOL_RESULT',
    DUPLICATE_TOOL_RESULT: 'AGENT_DUPLICATE_TOOL_RESULT',
    INCOMPLETE_TOOL_RESULTS: 'AGENT_INCOMPLETE_TOOL_RESULTS',
    MALFORMED_TOOL_CALL: 'AGENT_MALFORMED_TOOL_CALL',
    TOOL_CALL_NONCE_MISMATCH: 'AGENT_TOOL_CALL_NONCE_MISMATCH',
    TOOL_CALL_REQUIRED: 'AGENT_TOOL_CALL_REQUIRED',
    TOOL_CALL_FORBIDDEN: 'AGENT_TOOL_CALL_FORBIDDEN',
    TOOL_CHOICE_MISMATCH: 'AGENT_TOOL_CHOICE_MISMATCH',
    PARALLEL_TOOL_CALLS_UNSUPPORTED: 'AGENT_PARALLEL_TOOL_CALLS_UNSUPPORTED',
    RESPONSE_NOT_FOUND: 'AGENT_RESPONSE_NOT_FOUND',
    RESPONSE_EXPIRED: 'AGENT_RESPONSE_EXPIRED',
    RESPONSE_MODEL_MISMATCH: 'AGENT_RESPONSE_MODEL_MISMATCH',
    RESPONSE_STRATEGY_MISMATCH: 'AGENT_RESPONSE_STRATEGY_MISMATCH',
    PROVIDER_PARSE_FAILED: 'AGENT_PROVIDER_PARSE_FAILED',
    STATE_LIMIT: 'AGENT_STATE_LIMIT'
});

const DEFAULT_STATUS = 400;

export class AgentError extends Error {
    constructor(code, message, options = {}) {
        super(message);
        this.name = 'AgentError';
        this.code = code;
        this.status = options.status || DEFAULT_STATUS;
        this.type = options.type || 'invalid_request_error';
        this.details = options.details;
        this.retryable = options.retryable === true;
    }
}

export function isAgentError(error) {
    return error instanceof AgentError;
}

export function toAgentError(error, fallbackMessage = 'Agent compatibility processing failed') {
    if (isAgentError(error)) return error;
    if (error && typeof error === 'object' && typeof error.code === 'string') {
        return new AgentError(
            error.code,
            error.message || fallbackMessage,
            {
                status: error.status || DEFAULT_STATUS,
                type: error.type || (error.status >= 500 ? 'server_error' : 'invalid_request_error'),
                details: error.details,
                retryable: error.retryable === true
            }
        );
    }
    return new AgentError(
        AGENT_ERROR_CODES.INVALID_REQUEST,
        error?.message || fallbackMessage,
        { status: 400 }
    );
}

export function toOpenAIErrorPayload(error) {
    const normalized = toAgentError(error);
    return {
        error: {
            message: normalized.message,
            type: normalized.type,
            code: normalized.code
        }
    };
}
