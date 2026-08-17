import assert from 'node:assert/strict';
import test from 'node:test';

import {
    AGENT_ERROR_CODES,
    ConversationStore,
    buildOpenAIResponsesEvents,
    buildOpenAIResponsesObject,
    normalizeOpenAIResponsesRequest
} from '../src/agent/index.js';

const modelOptions = {
    requestId: 'responses-agent-test',
    getSupportedModels: () => ({ data: [{ id: 'chatgpt_text/gpt-instant', type: 'text' }] }),
    getModelType: () => 'text'
};

const readTool = {
    type: 'function',
    name: 'read_file',
    description: 'Read a file',
    parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
        additionalProperties: false
    }
};

test('Responses request normalizes function_call_output and retains call_id', () => {
    const store = new ConversationStore();
    store.save('resp_previous', {
        model: 'chatgpt_text/gpt-instant',
        instructions: [{ type: 'instruction', role: 'system', content: [{ type: 'text', text: 'rule' }] }],
        items: [
            { type: 'message', role: 'user', content: [{ type: 'text', text: 'read' }] },
            { type: 'tool_call', id: 'fc_1', callId: 'call_1', name: 'read_file', arguments: { path: 'package.json' } }
        ],
        tools: [readTool],
        toolChoice: { mode: 'auto' },
        parallelToolCalls: false,
        execution: { strategyId: 'openai_like_synthetic', adapterId: 'chatgpt_text' }
    });

    const request = normalizeOpenAIResponsesRequest({
        model: 'chatgpt_text/gpt-instant',
        previous_response_id: 'resp_previous',
        input: [{
            type: 'function_call_output',
            call_id: 'call_1',
            output: '{"name":"webai-2api"}'
        }]
    }, { ...modelOptions, conversationStore: store });

    assert.equal(request.protocol, 'openai_responses');
    assert.equal(request.items.at(-1).type, 'tool_result');
    assert.equal(request.items.at(-1).callId, 'call_1');
    assert.equal(request.metadata.expectedExecution.strategyId, 'openai_like_synthetic');
});

test('Responses request rejects a second result for the same call', () => {
    const store = new ConversationStore();
    store.save('resp_previous', {
        model: 'chatgpt_text/gpt-instant',
        instructions: [],
        items: [
            { type: 'tool_call', id: 'fc_1', callId: 'call_1', name: 'read_file', arguments: { path: 'x' } },
            { type: 'tool_result', callId: 'call_1', name: 'read_file', output: [{ type: 'text', text: 'ok' }], isError: false }
        ],
        tools: [readTool],
        toolChoice: { mode: 'auto' },
        parallelToolCalls: false
    });
    assert.throws(() => normalizeOpenAIResponsesRequest({
        model: 'chatgpt_text/gpt-instant',
        previous_response_id: 'resp_previous',
        input: [{ type: 'function_call_output', call_id: 'call_1', output: 'again' }]
    }, { ...modelOptions, conversationStore: store }), error => (
        error?.code === AGENT_ERROR_CODES.DUPLICATE_TOOL_RESULT
    ));
});

test('Responses output and buffered stream expose standard function_call events', () => {
    const request = normalizeOpenAIResponsesRequest({
        model: 'chatgpt_text/gpt-instant',
        instructions: 'be concise',
        input: 'read package.json',
        tools: [readTool],
        stream: true
    }, modelOptions);
    const turn = {
        items: [{
            type: 'tool_call',
            callId: 'call_responses',
            name: 'read_file',
            arguments: { path: 'package.json' }
        }]
    };
    const response = buildOpenAIResponsesObject(request, turn, 'resp_new', { now: 1000 });
    assert.equal(response.object, 'response');
    assert.equal(response.output[0].type, 'function_call');
    assert.equal(response.output[0].call_id, 'call_responses');
    assert.equal(response.output[0].arguments, '{"path":"package.json"}');

    const events = buildOpenAIResponsesEvents(response, turn);
    assert.equal(events[0].type, 'response.created');
    assert.ok(events.some(event => event.type === 'response.function_call_arguments.done'));
    assert.equal(events.at(-1).type, 'response.completed');
    assert.equal(events.at(-1).response.id, 'resp_new');
});

test('Responses accepts Codex built-in tools alongside function tools', () => {
    const request = normalizeOpenAIResponsesRequest({
        model: 'chatgpt_text/gpt-instant',
        input: 'hello',
        tools: [
            { type: 'web_search_preview' },
            readTool,
            { type: 'file_search' },
            {
                type: 'namespace',
                name: 'container',
                tools: [{
                    type: 'function',
                    name: 'shell_command',
                    description: 'Run a bounded command',
                    parameters: {
                        type: 'object',
                        properties: { command: { type: 'string' } },
                        required: ['command'],
                        additionalProperties: false
                    }
                }]
            }
        ],
        stream: true
    }, modelOptions);

    assert.deepEqual(request.tools.map(tool => tool.name), ['read_file', 'shell_command']);
});
