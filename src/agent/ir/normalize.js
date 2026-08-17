import { AgentError, AGENT_ERROR_CODES } from '../core/errors.js';
import { AGENT_PROTOCOLS, TOOL_CHOICE_MODES } from './schema.js';

export function normalizeToolChoice(value) {
    if (value === undefined || value === null || value === 'auto') {
        return { mode: TOOL_CHOICE_MODES.AUTO };
    }
    if (value === 'none') return { mode: TOOL_CHOICE_MODES.NONE };
    if (value === 'required') return { mode: TOOL_CHOICE_MODES.REQUIRED };

    if (typeof value === 'object') {
        const functionName = value.function?.name || value.name;
        if (value.type === 'function' && typeof functionName === 'string' && functionName) {
            return { mode: TOOL_CHOICE_MODES.FUNCTION, name: functionName };
        }
    }

    throw new AgentError(
        AGENT_ERROR_CODES.INVALID_REQUEST,
        'tool_choice must be auto, none, required, or a named function choice'
    );
}

export function createAgentRequest(fields) {
    if (!Object.values(AGENT_PROTOCOLS).includes(fields.protocol)) {
        throw new AgentError(AGENT_ERROR_CODES.INVALID_REQUEST, 'Unsupported Agent protocol');
    }
    if (!fields.requestId || !fields.model) {
        throw new AgentError(
            AGENT_ERROR_CODES.INVALID_REQUEST,
            'Agent requests require requestId and model'
        );
    }

    return {
        requestId: fields.requestId,
        protocol: fields.protocol,
        model: fields.model,
        instructions: fields.instructions || [],
        items: fields.items || [],
        tools: fields.tools || [],
        toolChoice: fields.toolChoice || { mode: TOOL_CHOICE_MODES.AUTO },
        parallelToolCalls: fields.parallelToolCalls === true,
        stream: fields.stream === true,
        metadata: fields.metadata || {}
    };
}
