import { contentPartsToText } from '../../ir/content-parts.js';

function responseMeta(model, options = {}) {
    const now = options.now || Date.now();
    return {
        id: options.id || `chatcmpl-${now}`,
        created: Math.floor(now / 1000),
        model: model || 'default-model'
    };
}

function splitTurn(assistantTurn) {
    const toolCalls = (assistantTurn.items || []).filter(item => item.type === 'tool_call');
    const messageItems = (assistantTurn.items || []).filter(item => item.type === 'message');
    const content = messageItems.length > 0
        ? messageItems.map(item => contentPartsToText(item.content)).join('')
        : null;
    return { toolCalls, content };
}

function buildToolCalls(toolCalls) {
    return toolCalls.map(call => ({
        id: call.callId,
        type: 'function',
        function: {
            name: call.name,
            arguments: JSON.stringify(call.arguments)
        }
    }));
}

export function buildOpenAIChatCompletion(assistantTurn, model, options = {}) {
    const meta = responseMeta(model, options);
    const { toolCalls, content } = splitTurn(assistantTurn);
    const message = {
        role: 'assistant',
        content: toolCalls.length > 0 ? content : (content ?? '')
    };
    if (toolCalls.length > 0) message.tool_calls = buildToolCalls(toolCalls);
    if (assistantTurn.reasoning) message.reasoning_content = assistantTurn.reasoning;

    return {
        ...meta,
        object: 'chat.completion',
        choices: [{
            index: 0,
            message,
            finish_reason: toolCalls.length > 0 ? 'tool_calls' : 'stop'
        }]
    };
}

export function buildOpenAIChatCompletionChunks(assistantTurn, model, options = {}) {
    const meta = responseMeta(model, options);
    const { toolCalls, content } = splitTurn(assistantTurn);
    const finishReason = toolCalls.length > 0 ? 'tool_calls' : 'stop';
    const delta = { role: 'assistant' };

    if (toolCalls.length > 0) {
        delta.content = content;
        delta.tool_calls = buildToolCalls(toolCalls).map((call, index) => ({ index, ...call }));
    } else {
        delta.content = content ?? '';
    }
    if (assistantTurn.reasoning) delta.reasoning_content = assistantTurn.reasoning;

    return [
        {
            ...meta,
            object: 'chat.completion.chunk',
            choices: [{ index: 0, delta, finish_reason: null }]
        },
        {
            ...meta,
            object: 'chat.completion.chunk',
            choices: [{ index: 0, delta: {}, finish_reason: finishReason }]
        }
    ];
}
