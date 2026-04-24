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

/** 解析 SSE 文本为 chunk 数组 */
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
