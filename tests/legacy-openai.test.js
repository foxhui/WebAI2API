import assert from 'node:assert/strict';
import test from 'node:test';

import { parseRequest } from '../src/server/api/openai/parse.js';
import {
    buildChatCompletion,
    buildChatCompletionChunk
} from '../src/server/respond.js';

const silentLogger = {
    info() { },
    warn() { },
    error() { },
    debug() { }
};

function parseOptions(overrides = {}) {
    return {
        tempDir: process.cwd(),
        imageLimit: 5,
        backendName: 'test',
        getSupportedModels: () => ({
            data: [{ id: 'chatgpt_text/gpt-instant', type: 'text' }]
        }),
        getImagePolicy: () => 'optional',
        getModelType: () => 'text',
        requestId: 'legacy-test',
        logger: silentLogger,
        ...overrides
    };
}

test('legacy text request keeps a plain final user prompt unchanged', async () => {
    const result = await parseRequest({
        model: 'chatgpt_text/gpt-instant',
        messages: [{ role: 'user', content: 'hello' }]
    }, parseOptions());

    assert.deepEqual(result, {
        success: true,
        data: {
            prompt: 'hello',
            imagePaths: [],
            modelId: 'chatgpt_text/gpt-instant',
            modelName: 'chatgpt_text/gpt-instant',
            isStreaming: false
        }
    });
});

test('legacy text request preserves the existing virtual-context format', async () => {
    const result = await parseRequest({
        model: 'chatgpt_text/gpt-instant',
        stream: true,
        messages: [
            { role: 'system', content: 'You are terse.' },
            { role: 'user', content: 'old question' },
            { role: 'assistant', content: 'old answer' },
            { role: 'user', content: 'new question' }
        ]
    }, parseOptions());

    assert.equal(result.success, true);
    assert.equal(
        result.data.prompt,
        '=== 系统指令 (永远置顶) ===\nYou are terse.\n\n' +
        '=== 历史对话 (滑动窗口或摘要) ===\n' +
        'User: old question\n' +
        'AI: old answer\n\n' +
        '=== 当前输入 ===\nUser: new question'
    );
    assert.equal(result.data.isStreaming, true);
});

test('legacy request still rejects an unsupported model', async () => {
    const result = await parseRequest({
        model: 'missing-model',
        messages: [{ role: 'user', content: 'hello' }]
    }, parseOptions());

    assert.equal(result.success, false);
    assert.equal(result.error.code, 'INVALID_MODEL');
    assert.match(result.error.error, /missing-model/);
});

test('legacy non-streaming response keeps content and stop finish reason', () => {
    const response = buildChatCompletion('answer', 'legacy-model', 'reasoning');

    assert.equal(response.object, 'chat.completion');
    assert.equal(response.model, 'legacy-model');
    assert.deepEqual(response.choices[0].message, {
        role: 'assistant',
        content: 'answer',
        reasoning_content: 'reasoning'
    });
    assert.equal(response.choices[0].finish_reason, 'stop');
});

test('legacy streaming response keeps the single content delta shape', () => {
    const chunk = buildChatCompletionChunk('answer', 'legacy-model');

    assert.equal(chunk.object, 'chat.completion.chunk');
    assert.deepEqual(chunk.choices[0].delta, { content: 'answer' });
    assert.equal(chunk.choices[0].finish_reason, 'stop');
});
