/**
 * @fileoverview 统一响应写出模块
 * @description 封装 JSON、SSE 响应和错误响应的统一处理函数
 */

import { getErrorDetails } from './errors.js';
import { toAgentError, toOpenAIErrorPayload } from '../agent/core/errors.js';
import {
    buildOpenAIChatCompletion,
    buildOpenAIChatCompletionChunks
} from '../agent/protocol/openai-chat/index.js';
import {
    buildOpenAIResponsesEvents,
    buildOpenAIResponsesObject
} from '../agent/protocol/openai-responses/index.js';

/**
 * 发送 JSON 响应
 * @param {import('http').ServerResponse} res - HTTP 响应对象
 * @param {number} status - HTTP 状态码
 * @param {object} payload - 响应数据
 */
export function sendJson(res, status, payload) {
    if (res.writableEnded) return;
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
}

/**
 * 发送 SSE 事件
 * @param {import('http').ServerResponse} res - HTTP 响应对象
 * @param {object} payload - 事件数据
 */
export function sendSse(res, payload) {
    if (res.writableEnded) return;
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

/**
 * 发送带有显式事件类型的 SSE。Responses API 客户端依赖 data.type，
 * 同时保留 event 行以兼容严格的 SSE 解析器。
 */
export function sendSseEvent(res, eventType, payload) {
    if (res.writableEnded) return;
    res.write(`event: ${eventType}\ndata: ${JSON.stringify(payload)}\n\n`);
}

export function sendSseComment(res, comment = 'keepalive') {
    if (res.writableEnded) return;
    res.write(`:${comment}\n\n`);
}

/**
 * 发送 SSE 结束标记
 * @param {import('http').ServerResponse} res - HTTP 响应对象
 */
export function sendSseDone(res) {
    if (res.writableEnded) return;
    res.write(`data: [DONE]\n\n`);
    res.end();
}

/**
 * 发送 SSE 心跳包
 * @param {import('http').ServerResponse} res - HTTP 响应对象
 * @param {string} mode - 心跳模式 ('comment' | 'content')
 * @param {string} [modelName] - 模型名称（content 模式需要）
 */
export function sendHeartbeat(res, mode, modelName) {
    if (res.writableEnded) return;

    if (mode === 'comment') {
        res.write(`:keepalive\n\n`);
    } else {
        // content 模式：发送空 delta
        const chunk = {
            id: 'chatcmpl-' + Date.now(),
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: modelName || 'default-model',
            choices: [{
                index: 0,
                delta: { content: '' },
                finish_reason: null
            }]
        };
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    }
}

/**
 * 发送统一 API 错误响应 (OpenAI 标准格式)
 * @param {import('http').ServerResponse} res - HTTP 响应对象
 * @param {object} options - 错误选项
 * @param {string} [options.code] - 错误码（使用 ERROR_CODES 枚举）
 * @param {string} [options.message] - 自定义错误消息（如提供则覆盖 code 对应的消息）
 * @param {number} [options.status] - 自定义 HTTP 状态码
 * @param {boolean} [options.isStreaming=false] - 是否为流式响应
 */
export function sendApiError(res, options) {
    const { code, message, status, type, isStreaming = false } = options;

    // 获取错误详情
    const details = code ? getErrorDetails(code) : null;
    const errorMessage = message || (details ? details.message : '未知错误');
    const errorType = type || details?.type || 'server_error';
    const httpStatus = status || (details ? details.status : 500);

    // 构造 OpenAI 标准错误响应体
    const payload = {
        error: {
            message: errorMessage,
            type: errorType,
            code: code || 'INTERNAL_ERROR'
        }
    };

    if (isStreaming) {
        // 流式响应：发送错误事件然后结束
        sendSse(res, payload);
        sendSseDone(res);
    } else {
        // 非流式响应
        sendJson(res, httpStatus, payload);
    }
}

/**
 * 发送 Agent 兼容层的 typed error，避免把解析/状态错误伪装成普通生成失败。
 */
export function sendAgentError(res, error, options = {}) {
    const normalized = toAgentError(error);
    const payload = toOpenAIErrorPayload(normalized);
    const isStreaming = options.isStreaming === true;
    const protocol = options.protocol || 'openai_chat';

    if (!isStreaming) {
        sendJson(res, normalized.status || 400, payload);
        return;
    }
    if (protocol === 'openai_responses') {
        sendSseEvent(res, 'error', payload);
        res.end();
        return;
    }
    sendSse(res, payload);
    sendSseDone(res);
}

export function sendOpenAIChatAgentResponse(res, request, assistantTurn, options = {}) {
    if (request.stream) {
        for (const chunk of buildOpenAIChatCompletionChunks(assistantTurn, request.model, options)) {
            sendSse(res, chunk);
        }
        sendSseDone(res);
        return;
    }
    sendJson(res, 200, buildOpenAIChatCompletion(assistantTurn, request.model, options));
}

export function sendOpenAIResponsesAgentResponse(res, request, assistantTurn, responseId, options = {}) {
    const response = buildOpenAIResponsesObject(request, assistantTurn, responseId, options);
    if (request.stream) {
        for (const event of buildOpenAIResponsesEvents(response, assistantTurn)) {
            sendSseEvent(res, event.type, event);
        }
        res.end();
        return response;
    }
    sendJson(res, 200, response);
    return response;
}

/**
 * 构造 OpenAI 格式的聊天完成响应（非流式）
 * @param {string} content - 响应内容
 * @param {string} [modelName] - 模型名称
 * @param {string} [reasoningContent] - 思考/推理过程内容 (OpenAI o1 格式)
 * @returns {object} OpenAI 格式的响应对象
 */
export function buildChatCompletion(content, modelName, reasoningContent) {
    const message = {
        role: 'assistant',
        content: content
    };
    if (reasoningContent) {
        message.reasoning_content = reasoningContent;
    }

    return {
        id: 'chatcmpl-' + Date.now(),
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: modelName || 'default-model',
        choices: [{
            index: 0,
            message,
            finish_reason: 'stop'
        }]
    };
}

/**
 * 构造 OpenAI 格式的流式聊天完成响应块
 * @param {string} content - 响应内容
 * @param {string} [modelName] - 模型名称
 * @param {string|null} [finishReason='stop'] - 完成原因
 * @param {string} [reasoningContent] - 思考/推理过程内容 (OpenAI o1 格式)
 * @returns {object} OpenAI 格式的流式响应块
 */
export function buildChatCompletionChunk(content, modelName, finishReason = 'stop', reasoningContent) {
    const delta = { content };
    if (reasoningContent) {
        delta.reasoning_content = reasoningContent;
    }

    return {
        id: 'chatcmpl-' + Date.now(),
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: modelName || 'default-model',
        choices: [{
            index: 0,
            delta,
            finish_reason: finishReason
        }]
    };
}
