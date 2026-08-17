import assert from 'node:assert/strict';
import test from 'node:test';

import {
    AGENT_ERROR_CODES,
    buildOpenAIChatCompletion,
    buildOpenAIChatCompletionChunks,
    isOpenAIChatAgentRequest,
    normalizeOpenAIChatRequest
} from '../src/agent/index.js';

const modelOptions = {
    requestId: 'chat-agent-test',
    getSupportedModels: () => ({ data: [{ id: 'chatgpt_text/gpt-instant', type: 'text' }] }),
    getModelType: () => 'text'
};

const readTool = {
    type: 'function',
    function: {
        name: 'read_file',
        description: 'Read a file',
        parameters: {
            type: 'object',
            properties: { path: { type: 'string' } },
            required: ['path'],
            additionalProperties: false
        }
    }
};

test('plain Chat request is not diverted into the Agent path', () => {
    assert.equal(isOpenAIChatAgentRequest({
        messages: [{ role: 'user', content: 'hello' }]
    }), false);
    assert.equal(isOpenAIChatAgentRequest({
        tools: [],
        messages: [{ role: 'user', content: 'hello' }]
    }), false);
    assert.equal(isOpenAIChatAgentRequest({
        tools: [readTool],
        messages: [{ role: 'user', content: 'read a file' }]
    }), true);
});

test('Chat protocol keeps developer, assistant call, role tool, and tool_call_id semantics', () => {
    const request = normalizeOpenAIChatRequest({
        model: 'chatgpt_text/gpt-instant',
        tools: [readTool],
        tool_choice: 'auto',
        messages: [
            { role: 'system', content: 'system rule' },
            { role: 'developer', content: 'developer rule' },
            { role: 'user', content: 'read it' },
            {
                role: 'assistant',
                content: null,
                tool_calls: [{
                    id: 'call_original',
                    type: 'function',
                    function: { name: 'read_file', arguments: '{"path":"package.json"}' }
                }]
            },
            {
                role: 'tool',
                tool_call_id: 'call_original',
                content: '{"name":"webai-2api"}'
            }
        ]
    }, modelOptions);

    assert.deepEqual(request.instructions.map(item => item.role), ['system', 'developer']);
    assert.equal(request.items[1].type, 'tool_call');
    assert.equal(request.items[1].callId, 'call_original');
    assert.deepEqual(request.items[1].arguments, { path: 'package.json' });
    assert.equal(request.items[2].type, 'tool_result');
    assert.equal(request.items[2].callId, 'call_original');
});

test('Chat protocol rejects an orphan tool result instead of flattening it', () => {
    assert.throws(() => normalizeOpenAIChatRequest({
        model: 'chatgpt_text/gpt-instant',
        tools: [readTool],
        messages: [
            { role: 'user', content: 'read it' },
            { role: 'tool', tool_call_id: 'call_missing', content: 'fake result' }
        ]
    }, modelOptions), error => error?.code === AGENT_ERROR_CODES.ORPHAN_TOOL_RESULT);
});

test('Chat tool call response uses JSON-string arguments and tool_calls finish reason', () => {
    const turn = {
        items: [{
            type: 'tool_call',
            callId: 'call_abc',
            name: 'read_file',
            arguments: { path: 'package.json' }
        }]
    };
    const response = buildOpenAIChatCompletion(turn, 'model', { id: 'chatcmpl-test', now: 1000 });
    assert.equal(response.choices[0].message.content, null);
    assert.equal(response.choices[0].message.tool_calls[0].id, 'call_abc');
    assert.equal(response.choices[0].message.tool_calls[0].function.arguments, '{"path":"package.json"}');
    assert.equal(response.choices[0].finish_reason, 'tool_calls');

    const chunks = buildOpenAIChatCompletionChunks(turn, 'model', { id: 'chatcmpl-test', now: 1000 });
    assert.equal(chunks.length, 2);
    assert.equal(chunks[0].choices[0].delta.tool_calls[0].index, 0);
    assert.equal(chunks[1].choices[0].finish_reason, 'tool_calls');
});
