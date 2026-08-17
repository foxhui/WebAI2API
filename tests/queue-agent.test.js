import assert from 'node:assert/strict';
import test from 'node:test';

import { ConversationStore } from '../src/agent/index.js';
import { createQueueManager } from '../src/server/queue.js';

function responseRecorder() {
    const chunks = [];
    return {
        chunks,
        writableEnded: false,
        headersSent: false,
        writeHead(status, headers) {
            this.statusCode = status;
            this.headers = headers;
            this.headersSent = true;
        },
        write(chunk) { chunks.push(String(chunk)); },
        end(chunk) {
            if (chunk) chunks.push(String(chunk));
            this.writableEnded = true;
        }
    };
}

const chatRequest = {
    requestId: 'queue-agent-chat',
    protocol: 'openai_chat',
    model: 'chatgpt_text/gpt-instant',
    instructions: [],
    items: [{ type: 'message', role: 'user', content: [{ type: 'text', text: 'read' }] }],
    tools: [],
    toolChoice: { mode: 'auto' },
    parallelToolCalls: false,
    stream: false,
    metadata: { route: '/v1/chat/completions' }
};

test('queue writes a structured Chat tool call without executing it', async () => {
    const res = responseRecorder();
    const queue = createQueueManager({ maxConcurrent: 1, queueBuffer: 1, keepaliveMode: 'comment' }, {
        initBrowser: async () => ({ poolManager: {} }),
        generate: async () => ({
            text: '',
            agentTurn: {
                items: [{
                    type: 'tool_call',
                    callId: 'call_queue',
                    name: 'read_file',
                    arguments: { path: 'package.json' }
                }]
            },
            agentExecution: {
                adapterId: 'chatgpt_text',
                modelId: 'gpt-instant',
                strategyId: 'openai_like_synthetic',
                parserId: 'openai_style_synthetic'
            }
        }),
        config: {},
        conversationStore: new ConversationStore()
    });
    queue.addTask({
        req: {},
        res,
        prompt: '',
        imagePaths: [],
        modelId: chatRequest.model,
        modelName: chatRequest.model,
        id: 'queue-chat-id',
        isStreaming: false,
        reasoning: false,
        agentRequest: chatRequest
    });

    await new Promise(resolve => setTimeout(resolve, 80));
    const payload = JSON.parse(res.chunks.join(''));
    assert.equal(payload.choices[0].finish_reason, 'tool_calls');
    assert.equal(payload.choices[0].message.tool_calls[0].id, 'call_queue');
});

test('queue persists Responses history only after a successful Agent turn', async () => {
    const res = responseRecorder();
    const store = new ConversationStore();
    const request = {
        ...chatRequest,
        requestId: 'queue-agent-responses',
        protocol: 'openai_responses',
        metadata: { route: '/v1/responses' }
    };
    const queue = createQueueManager({ maxConcurrent: 1, queueBuffer: 1, keepaliveMode: 'comment' }, {
        initBrowser: async () => ({ poolManager: {} }),
        generate: async () => ({
            text: 'done',
            agentTurn: {
                items: [{
                    type: 'message',
                    role: 'assistant',
                    content: [{ type: 'text', text: 'done' }]
                }]
            },
            agentExecution: {
                adapterId: 'chatgpt_text',
                modelId: 'gpt-instant',
                strategyId: 'openai_like_synthetic',
                parserId: 'openai_style_synthetic'
            }
        }),
        config: {},
        conversationStore: store
    });
    queue.addTask({
        req: {},
        res,
        prompt: '',
        imagePaths: [],
        modelId: request.model,
        modelName: request.model,
        id: 'queue-responses-id',
        responseId: 'resp_queue',
        isStreaming: false,
        reasoning: false,
        agentRequest: request
    });

    await new Promise(resolve => setTimeout(resolve, 80));
    const payload = JSON.parse(res.chunks.join(''));
    assert.equal(payload.object, 'response');
    assert.equal(store.get('resp_queue').items.at(-1).content[0].text, 'done');
});
