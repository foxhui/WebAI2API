/**
 * WebAI2API HTTP API E2E 测试
 * @description 测试 OpenAI 兼容 API：认证、模型列表、流式/非流式生成
 * @note 需要服务已启动，配置在 e2e/.env
 */

import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// --- 加载 .env 配置 ---

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '.env');
const envContent = fs.readFileSync(envPath, 'utf-8');
const env = {};
for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
}

const BASE_URL = env.API_BASE_URL || 'http://localhost:9330';
const AUTH_TOKEN = env.API_AUTH_TOKEN || '';
const MODEL = env.API_MODEL || 'deepseek_text/deepseek-v4-flash';

// --- 辅助函数 ---

/** 发起 API 请求 */
async function apiRequest(path, options = {}) {
    const url = `${BASE_URL}${path}`;
    const headers = {
        'Content-Type': 'application/json',
        ...(AUTH_TOKEN ? { 'Authorization': `Bearer ${AUTH_TOKEN}` } : {}),
        ...options.headers,
    };
    return fetch(url, { ...options, headers });
}

/** 解析 Chat Completions SSE 文本为 chunk 数组 */
function parseSSE(body) {
    const chunks = [];
    for (const line of body.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') {
            chunks.push({ type: 'done' });
        } else {
            try {
                chunks.push({ type: 'chunk', data: JSON.parse(data) });
            } catch { /* 忽略非 JSON 行 */ }
        }
    }
    return chunks;
}

/** 解析 Responses API SSE 文本为 event 数组 */
function parseResponsesSSE(body) {
    const events = [];
    const lines = body.split('\n');
    let currentEvent = '';
    for (const line of lines) {
        if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim();
        } else if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            try {
                events.push({ event: currentEvent, data: JSON.parse(data) });
            } catch { /* 忽略非 JSON 行 */ }
            currentEvent = '';
        }
    }
    return events;
}

// --- 测试 ---

test.describe('API 认证', () => {
    test('无 token 时返回 401', async () => {
        const resp = await fetch(`${BASE_URL}/v1/models`);
        expect(resp.status).toBe(401);
        const body = await resp.json();
        expect(body.error).toBeTruthy();
        expect(body.error.type).toBe('invalid_request_error');
    });

    test('错误 token 时返回 401', async () => {
        const resp = await fetch(`${BASE_URL}/v1/models`, {
            headers: { 'Authorization': 'Bearer wrong-token' },
        });
        expect(resp.status).toBe(401);
    });
});

test.describe('GET /v1/models', () => {
    test('返回正确的列表格式', async () => {
        const resp = await apiRequest('/v1/models');
        expect(resp.status).toBe(200);
        const body = await resp.json();
        expect(body.object).toBe('list');
        expect(Array.isArray(body.data)).toBe(true);
        expect(body.data.length).toBeGreaterThan(0);
    });

    test('模型包含必要字段', async () => {
        const resp = await apiRequest('/v1/models');
        const body = await resp.json();
        for (const model of body.data) {
            expect(model.id).toBeTruthy();
            expect(model.object).toBe('model');
            expect(model.owned_by).toBeTruthy();
        }
    });

    test(`配置的模型 ${MODEL} 在列表中`, async () => {
        const resp = await apiRequest('/v1/models');
        const body = await resp.json();
        const found = body.data.some(m => m.id === MODEL);
        expect(found).toBe(true);
    });
});

test.describe('POST /v1/chat/completions', () => {
    test('非流式请求返回正确格式', async () => {
        const resp = await apiRequest('/v1/chat/completions', {
            method: 'POST',
            body: JSON.stringify({
                model: MODEL,
                messages: [{ role: 'user', content: 'Reply with exactly: hello' }],
                stream: false,
            }),
        });

        expect(resp.status).toBe(200);
        const body = await resp.json();

        // OpenAI 格式验证
        expect(body.id).toBeTruthy();
        expect(body.object).toBe('chat.completion');
        expect(body.model).toBe(MODEL);
        expect(Array.isArray(body.choices)).toBe(true);
        expect(body.choices.length).toBe(1);

        const choice = body.choices[0];
        expect(choice.index).toBe(0);
        expect(choice.message.role).toBe('assistant');
        expect(choice.message.content).toBeTruthy();
        expect(choice.finish_reason).toBe('stop');

        console.log(`[非流式] 回复: ${choice.message.content.slice(0, 80)}`);
    });

    test('流式请求返回 SSE 并最终完成', async () => {
        const resp = await apiRequest('/v1/chat/completions', {
            method: 'POST',
            body: JSON.stringify({
                model: MODEL,
                messages: [{ role: 'user', content: 'Reply with exactly: hi' }],
                stream: true,
            }),
        });

        expect(resp.status).toBe(200);
        expect(resp.headers.get('content-type')).toContain('text/event-stream');

        // 读取完整响应后解析 SSE
        const body = await resp.text();
        const chunks = parseSSE(body);

        // 至少有一个 data chunk 和一个 [DONE]
        const dataChunks = chunks.filter(c => c.type === 'chunk');
        const doneChunks = chunks.filter(c => c.type === 'done');
        expect(dataChunks.length).toBeGreaterThan(0);
        expect(doneChunks.length).toBe(1);

        // 提取所有文本内容
        const textParts = dataChunks
            .filter(c => c.data.choices?.[0]?.delta?.content)
            .map(c => c.data.choices[0].delta.content);
        const fullText = textParts.join('');
        expect(fullText.length).toBeGreaterThan(0);

        // 验证 chunk 格式
        expect(dataChunks[0].data.object).toBe('chat.completion.chunk');
        expect(dataChunks[0].data.model).toBe(MODEL);

        console.log(`[流式] 回复 (${dataChunks.length} chunks): ${fullText.slice(0, 80)}`);
    });

    test('无效模型返回 400', async () => {
        const resp = await apiRequest('/v1/chat/completions', {
            method: 'POST',
            body: JSON.stringify({
                model: 'nonexistent-model',
                messages: [{ role: 'user', content: 'hello' }],
            }),
        });

        expect(resp.status).toBe(400);
        const body = await resp.json();
        expect(body.error).toBeTruthy();
        expect(body.error.type).toBe('invalid_request_error');
    });

    test('空消息返回 400', async () => {
        const resp = await apiRequest('/v1/chat/completions', {
            method: 'POST',
            body: JSON.stringify({
                model: MODEL,
                messages: [],
            }),
        });

        expect(resp.status).toBe(400);
        const body = await resp.json();
        expect(body.error).toBeTruthy();
    });
});

test.describe('POST /v1/responses', () => {
    test('非流式请求返回正确格式', async () => {
        const resp = await apiRequest('/v1/responses', {
            method: 'POST',
            body: JSON.stringify({
                model: MODEL,
                input: [{ role: 'user', content: 'Reply with exactly: hello' }],
                stream: false,
            }),
        });

        expect(resp.status).toBe(200);
        const body = await resp.json();

        // Responses API 格式验证
        expect(body.id).toBeTruthy();
        expect(body.id.startsWith('resp_')).toBe(true);
        expect(body.object).toBe('response');
        expect(body.status).toBe('completed');
        expect(body.model).toBe(MODEL);
        expect(Array.isArray(body.output)).toBe(true);
        expect(body.output.length).toBeGreaterThan(0);

        // 最后一个 output 应该是 message 类型
        const message = body.output.find(o => o.type === 'message');
        expect(message).toBeTruthy();
        expect(message.role).toBe('assistant');
        expect(message.content[0].type).toBe('output_text');
        expect(message.content[0].text).toBeTruthy();

        console.log(`[Responses 非流式] 回复: ${message.content[0].text.slice(0, 80)}`);
    });

    test('流式请求返回 SSE 并最终完成', async () => {
        const resp = await apiRequest('/v1/responses', {
            method: 'POST',
            body: JSON.stringify({
                model: MODEL,
                input: [{ role: 'user', content: 'Reply with exactly: hi' }],
                stream: true,
            }),
        });

        expect(resp.status).toBe(200);
        expect(resp.headers.get('content-type')).toContain('text/event-stream');

        // 读取完整响应后解析 SSE
        const body = await resp.text();
        const events = parseResponsesSSE(body);

        // 应该有 response.created 事件
        const created = events.find(e => e.event === 'response.created');
        expect(created).toBeTruthy();

        // 应该有 delta 事件
        const deltas = events.filter(e => e.event === 'response.output_text.delta');
        expect(deltas.length).toBeGreaterThan(0);
        const fullText = deltas.map(e => e.data.delta).join('');
        expect(fullText.length).toBeGreaterThan(0);

        // 应该有 response.completed 事件
        const completed = events.find(e => e.event === 'response.completed');
        expect(completed).toBeTruthy();
        expect(completed.data.response.status).toBe('completed');

        console.log(`[Responses 流式] 回复 (${deltas.length} deltas): ${fullText.slice(0, 80)}`);
    });
});

test.describe('持续性对话', () => {
    test('连续多次请求均成功（继续同一对话）', async () => {
        const prompts = [
            'Reply with exactly: first',
            'Reply with exactly: second',
            'Reply with exactly: third',
        ];

        for (let i = 0; i < prompts.length; i++) {
            const resp = await apiRequest('/v1/chat/completions', {
                method: 'POST',
                body: JSON.stringify({
                    model: MODEL,
                    messages: [{ role: 'user', content: prompts[i] }],
                    stream: false,
                }),
            });

            expect(resp.status).toBe(200);
            const body = await resp.json();
            expect(body.object).toBe('chat.completion');
            expect(body.choices[0].message.content).toBeTruthy();

            console.log(`[持续对话 ${i + 1}/${prompts.length}] 回复: ${body.choices[0].message.content.slice(0, 80)}`);
        }
    });

    test('对话上下文连续性（模型记住之前的消息）', async () => {
        // 第一轮：告诉模型一个唯一标识
        const uniqueId = `unicorn_${Date.now()}`;
        const resp1 = await apiRequest('/v1/chat/completions', {
            method: 'POST',
            body: JSON.stringify({
                model: MODEL,
                messages: [{ role: 'user', content: `Remember this word: ${uniqueId}. Reply with exactly: remembered` }],
                stream: false,
            }),
        });
        expect(resp1.status).toBe(200);
        const body1 = await resp1.json();
        console.log(`[上下文 1/2] 回复: ${body1.choices[0].message.content.slice(0, 80)}`);

        // 第二轮：问模型之前记住的词（不重复提示）
        const resp2 = await apiRequest('/v1/chat/completions', {
            method: 'POST',
            body: JSON.stringify({
                model: MODEL,
                messages: [{ role: 'user', content: 'What word did I ask you to remember? Reply with only the word.' }],
                stream: false,
            }),
        });
        expect(resp2.status).toBe(200);
        const body2 = await resp2.json();
        const reply = body2.choices[0].message.content;
        console.log(`[上下文 2/2] 回复: ${reply.slice(0, 80)}`);

        // 验证模型记住了之前的词
        expect(reply.toLowerCase()).toContain(uniqueId.toLowerCase());
    });

    test('Responses API 连续多次请求均成功', async () => {
        const prompts = [
            'Reply with exactly: alpha',
            'Reply with exactly: beta',
        ];

        for (let i = 0; i < prompts.length; i++) {
            const resp = await apiRequest('/v1/responses', {
                method: 'POST',
                body: JSON.stringify({
                    model: MODEL,
                    input: [{ role: 'user', content: prompts[i] }],
                    stream: false,
                }),
            });

            expect(resp.status).toBe(200);
            const body = await resp.json();
            expect(body.object).toBe('response');
            expect(body.status).toBe('completed');

            const message = body.output.find(o => o.type === 'message');
            expect(message).toBeTruthy();
            expect(message.content[0].text).toBeTruthy();

            console.log(`[Responses 持续 ${i + 1}/${prompts.length}] 回复: ${message.content[0].text.slice(0, 80)}`);
        }
    });
});
