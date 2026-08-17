import { AgentError, AGENT_ERROR_CODES } from '../core/errors.js';

function textPart(text) {
    return { type: 'text', text: String(text ?? '') };
}

function imagePart(item) {
    const source = item.image_url ?? item.imageUrl ?? item;
    const url = typeof source === 'string' ? source : source?.url;
    if (!url || typeof url !== 'string') {
        throw new AgentError(
            AGENT_ERROR_CODES.UNSUPPORTED_CONTENT,
            'Image content is missing image_url.url'
        );
    }
    return {
        type: 'image_url',
        url,
        detail: source?.detail || item.detail || 'auto'
    };
}

export function normalizeContentParts(content, options = {}) {
    const { allowImages = false, field = 'content' } = options;

    if (content === null || content === undefined) return [];
    if (typeof content === 'string') return [textPart(content)];
    if (!Array.isArray(content)) {
        throw new AgentError(
            AGENT_ERROR_CODES.UNSUPPORTED_CONTENT,
            `${field} must be a string or content-part array`
        );
    }

    const parts = [];
    for (const item of content) {
        if (!item || typeof item !== 'object') {
            throw new AgentError(
                AGENT_ERROR_CODES.UNSUPPORTED_CONTENT,
                `${field} contains an invalid content part`
            );
        }

        if (['text', 'input_text', 'output_text'].includes(item.type)) {
            if (typeof item.text !== 'string') {
                throw new AgentError(
                    AGENT_ERROR_CODES.UNSUPPORTED_CONTENT,
                    `${field} text parts must contain a string text field`
                );
            }
            parts.push(textPart(item.text));
            continue;
        }

        if (['image_url', 'input_image'].includes(item.type)) {
            if (!allowImages) {
                throw new AgentError(
                    AGENT_ERROR_CODES.UNSUPPORTED_CONTENT,
                    'Image content is not supported together with Agent tools in this release'
                );
            }
            parts.push(imagePart(item));
            continue;
        }

        if (item.type === 'refusal' && typeof item.refusal === 'string') {
            parts.push(textPart(item.refusal));
            continue;
        }

        throw new AgentError(
            AGENT_ERROR_CODES.UNSUPPORTED_CONTENT,
            `Unsupported content part type: ${item.type || 'unknown'}`
        );
    }

    return parts;
}

export function normalizeToolOutput(output, field = 'output') {
    if (typeof output === 'string') return [textPart(output)];
    return normalizeContentParts(output, { allowImages: false, field });
}

export function contentPartsToText(parts) {
    return (parts || []).map(part => {
        if (part.type === 'text') return part.text;
        if (part.type === 'image_url') {
            return part.url.startsWith('data:') ? '[embedded image]' : `[image: ${part.url}]`;
        }
        return '';
    }).join('');
}

export function contentPartsToResponseInput(parts, type = 'input_text') {
    return (parts || []).map(part => {
        if (part.type === 'text') return { type, text: part.text };
        return {
            type: 'input_image',
            image_url: part.url,
            detail: part.detail || 'auto'
        };
    });
}
