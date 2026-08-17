import { AgentError, AGENT_ERROR_CODES } from '../core/errors.js';

export function assertSupportedTextModel(model, options) {
    if (!model || typeof model !== 'string') {
        throw new AgentError(AGENT_ERROR_CODES.INVALID_MODEL, 'model is required');
    }
    const models = options.getSupportedModels?.()?.data || [];
    if (!models.some(candidate => candidate.id === model)) {
        throw new AgentError(
            AGENT_ERROR_CODES.INVALID_MODEL,
            `Model is not available from this WebAI2API deployment: ${model}`
        );
    }
    const type = options.getModelType?.(model) || models.find(candidate => candidate.id === model)?.type;
    if (type !== 'text') {
        throw new AgentError(
            AGENT_ERROR_CODES.INVALID_MODEL,
            `Agent tools require a text model: ${model}`
        );
    }
    return model;
}
