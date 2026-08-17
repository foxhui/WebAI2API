import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';

import { ConversationStore } from '../src/agent/index.js';
import { createOpenAIRouter } from '../src/server/api/openai/routes.js';

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

function responseRecorder() {
    const chunks = [];
    return {
        chunks,
        statusCode: null,
        headers: null,
        writableEnded: false,
        headersSent: false,
        writeHead(status, headers) {
            this.statusCode = status;
            this.headers = headers;
            this.headersSent = true;
        },
        write(chunk) {
            chunks.push(String(chunk));
        },
        end(chunk) {
            if (chunk) chunks.push(String(chunk));
            this.writableEnded = true;
        }
    };
}

function makeRouter({ enabled = true, tasks = [], store = new ConversationStore() } = {}) {
    const queueManager = {
        maxQueueSize: 3,
        canAcceptNonStreaming: () => true,
        getStatus: () => ({ total: 0 }),
        addTask: task => tasks.push(task),
        getPoolContext: () => null
    };
    const router = createOpenAIRouter({
        backendName: 'test',
        config: { agentCompatibility: { enabled, conversationTtlMs: 1000, maxStoredResponses: 10 } },
        getModels: () => ({ data: [{ id: 'chatgpt_text/gpt-instant', type: 'text' }] }),
        getModelType: () => 'text',
        getImagePolicy: () => 'optional',
        tempDir: process.cwd(),
        imageLimit: 5,
        queueManager,
        conversationStore: store
    });
    return { router, tasks, store };
}

function request(body) {
    const stream = Readable.from([Buffer.from(JSON.stringify(body))]);
    stream.method = 'POST';
    stream.url = '/v1';
    return stream;
}

test('Chat Agent route enqueues structured IR and does not flatten tools into prompt', async () => {
    const tasks = [];
    const { router } = makeRouter({ tasks });
    const res = responseRecorder();
    await router(request({
        model: 'chatgpt_text/gpt-instant',
        tools: [readTool],
        messages: [{ role: 'user', content: 'read package.json' }]
    }), res, '/chat/completions', new URL('http://test/v1/chat/completions'));

    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].agentRequest.protocol, 'openai_chat');
    assert.equal(tasks[0].agentRequest.items[0].type, 'message');
    assert.equal(tasks[0].prompt, '');
    assert.equal(res.statusCode, null);
});

test('Responses route allocates a response ID and uses the shared TTL store', async () => {
    const tasks = [];
    const store = new ConversationStore();
    const { router } = makeRouter({ tasks, store });
    const res = responseRecorder();
    await router(request({
        model: 'chatgpt_text/gpt-instant',
        input: 'read package.json',
        tools: [{
            type: 'function',
            name: 'read_file',
            description: 'Read a file',
            parameters: readTool.function.parameters
        }]
    }), res, '/responses', new URL('http://test/v1/responses'));

    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].agentRequest.protocol, 'openai_responses');
    assert.match(tasks[0].responseId, /^resp_/);
    assert.equal(store.size, 0);
});

test('Agent route returns an explicit disabled error without touching the queue', async () => {
    const tasks = [];
    const { router } = makeRouter({ enabled: false, tasks });
    const res = responseRecorder();
    await router(request({
        model: 'chatgpt_text/gpt-instant',
        tools: [readTool],
        messages: [{ role: 'user', content: 'read package.json' }]
    }), res, '/chat/completions', new URL('http://test/v1/chat/completions'));

    assert.equal(tasks.length, 0);
    assert.equal(res.statusCode, 400);
    const payload = JSON.parse(res.chunks.join(''));
    assert.equal(payload.error.code, 'AGENT_COMPATIBILITY_DISABLED');
});
