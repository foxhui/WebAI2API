/**
 * @fileoverview OpenAI Responses API 适配器
 * @description 将 /v1/responses 请求转换为 /v1/chat/completions 格式
 * @see https://platform.openai.com/docs/api-reference/responses
 */

import crypto from 'crypto';
import { logger } from '../../../utils/logger.js';
import { ERROR_CODES } from '../../errors.js';
import { sendJson, sendSse, sendSseDone, sendApiError, sendHeartbeat } from '../../respond.js';
import { parseRequest } from './parse.js';

/**
 * 将 Responses API input 格式转换为 Chat Completions messages 格式
 * @param {Array} input - Responses API 的 input 数组
 * @returns {Array} Chat Completions 的 messages 数组
 */
function convertInputToMessages(input) {
    if (!Array.isArray(input)) return [];

    return input.map(item => {
        const message = { role: item.role };

        // 处理 content：可能是字符串或数组
        if (typeof item.content === 'string') {
            message.content = item.content;
        } else if (Array.isArray(item.content)) {
            message.content = item.content.map(part => {
                // input_text -> text
                if (part.type === 'input_text') {
                    return { type: 'text', text: part.text || '' };
                }
                // input_image -> image_url
                if (part.type === 'input_image') {
                    return {
                        type: 'image_url',
                        image_url: { url: part.image_url || part.url || '' }
                    };
                }
                // 已经是 Chat Completions 格式
                if (part.type === 'text' || part.type === 'image_url') {
                    return part;
                }
                // 其他类型转为文本
                return { type: 'text', text: JSON.stringify(part) };
            });
        } else {
            message.content = '';
        }

        return message;
    });
}

/**
 * 生成 Responses API 格式的响应 ID
 */
function generateResponseId() {
    return 'resp_' + crypto.randomUUID().replace(/-/g, '').slice(0, 24);
}

/**
 * 构造 Responses API 格式的非流式响应
 */
function buildResponsesOutput(content, model, reasoningContent) {
    const output = [];

    if (reasoningContent) {
        output.push({
            type: 'reasoning',
            id: 'rs_' + crypto.randomUUID().replace(/-/g, '').slice(0, 24),
            status: 'completed',
            summary: [],
            content: [{ type: 'reasoning_text', text: reasoningContent }]
        });
    }

    output.push({
        type: 'message',
        id: 'msg_' + crypto.randomUUID().replace(/-/g, '').slice(0, 24),
        status: 'completed',
        role: 'assistant',
        content: [{
            type: 'output_text',
            text: content,
            annotations: []
        }]
    });

    return {
        id: generateResponseId(),
        object: 'response',
        created_at: Math.floor(Date.now() / 1000),
        model,
        output,
        usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
        status: 'completed'
    };
}

/**
 * 发送 Responses API 流式事件
 */
function sendResponseSse(res, event, data) {
    if (res.writableEnded) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/**
 * 创建 Responses API 路由处理器
 * @param {object} context - 与 chat/completions 共享的上下文
 * @returns {Function} 路由处理函数
 */
export function createResponsesHandler(context) {
    const {
        backendName,
        getModels,
        getImagePolicy,
        getModelType,
        tempDir,
        imageLimit,
        queueManager
    } = context;

    return async function handleResponses(req, res, requestId) {
        const chunks = [];
        for await (const chunk of req) {
            chunks.push(chunk);
        }

        try {
            const body = Buffer.concat(chunks).toString();
            const data = JSON.parse(body);
            const isStreaming = data.stream === true;

            // 转换 input -> messages
            const messages = convertInputToMessages(data.input);

            // 构造 Chat Completions 格式的请求
            const chatRequest = {
                model: data.model,
                messages,
                stream: false,
                max_tokens: data.max_output_tokens,
                temperature: data.temperature,
                top_p: data.top_p
            };

            // 限流检查（非流式）
            if (!isStreaming && !queueManager.canAcceptNonStreaming()) {
                const status = queueManager.getStatus();
                sendApiError(res, {
                    code: ERROR_CODES.SERVER_BUSY,
                    message: `服务器繁忙（队列: ${status.total}/${queueManager.maxQueueSize}）。请使用流式模式或稍后重试。`
                });
                return;
            }

            // 设置响应头
            if (isStreaming) {
                res.writeHead(200, {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive'
                });
            }

            // 解析请求（复用 chat/completions 的解析逻辑）
            const parseResult = await parseRequest(chatRequest, {
                tempDir,
                imageLimit,
                backendName,
                getSupportedModels: getModels,
                getImagePolicy,
                getModelType,
                requestId,
                logger
            });

            if (!parseResult.success) {
                if (isStreaming) {
                    sendResponseSse(res, 'error', {
                        error: { message: parseResult.error.error, type: 'invalid_request_error' }
                    });
                    res.end();
                } else {
                    sendApiError(res, {
                        code: parseResult.error.code,
                        message: parseResult.error.error
                    });
                }
                return;
            }

            const { prompt, imagePaths, modelId, modelName } = parseResult.data;
            const responseId = generateResponseId();

            logger.info('服务器', `[Responses] 请求入队: ${prompt.slice(0, 100)}...`, { id: requestId });

            // 创建代理 res 对象
            const proxyRes = createResponseProxy(res, responseId, modelName, isStreaming);

            // 发送到队列处理
            queueManager.addTask({
                req,
                res: proxyRes,
                prompt,
                imagePaths,
                modelId,
                modelName,
                id: requestId,
                isStreaming,
                reasoning: false
            });

        } catch (err) {
            logger.error('服务器', '[Responses] 请求处理失败', { id: requestId, error: err.message });
            sendApiError(res, {
                code: ERROR_CODES.INTERNAL_ERROR,
                message: err.message
            });
        }
    };
}

/**
 * 创建 Responses API 流式响应代理
 * 将 Chat Completions 的 SSE 事件转换为 Responses API 格式
 */
function createResponseProxy(res, responseId, modelName, isStreaming) {
    let outputIndex = 0;
    let contentIndex = 0;
    let hasStarted = false;
    let headerWritten = false;
    let doneSent = false;
    let accumulatedText = '';
    let accumulatedReasoning = '';
    let currentItemId = null;

    return {
        get writableEnded() { return res.writableEnded; },
        get headersSent() { return res.headersSent || headerWritten; },

        writeHead(status, headers) {
            headerWritten = true;
            return res.writeHead(status, headers);
        },

        write(data) {
            if (res.writableEnded) return true;

            if (!isStreaming) {
                // 非流式模式，直接写入（sendJson 会调用 writeHead + write + end）
                return res.write(data);
            }

            // 流式模式：解析 Chat Completions SSE 并转换为 Responses API 格式
            const str = typeof data === 'string' ? data : data.toString();

            // 传递心跳注释（:keepalive）
            if (str.startsWith(':')) {
                return res.write(data);
            }

            const lines = str.split('\n');

            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                const payload = line.slice(6).trim();

                if (payload === '[DONE]') {
                    if (!doneSent && hasStarted) {
                        doneSent = true;
                        // 构建 output 内容
                        const outputItems = [];
                        if (accumulatedReasoning) {
                            outputItems.push({
                                type: 'reasoning',
                                id: 'rs_' + crypto.randomUUID().replace(/-/g, '').slice(0, 24),
                                status: 'completed',
                                summary: [],
                                content: [{ type: 'reasoning_text', text: accumulatedReasoning }]
                            });
                        }
                        outputItems.push({
                            type: 'message',
                            id: currentItemId,
                            status: 'completed',
                            role: 'assistant',
                            content: [{ type: 'output_text', text: accumulatedText, annotations: [] }]
                        });

                        sendResponseSse(res, 'response.content_part.done', {
                            type: 'response.content_part.done',
                            item_id: currentItemId,
                            output_index: outputIndex,
                            content_index: contentIndex,
                            part: { type: 'output_text', text: accumulatedText, annotations: [] }
                        });
                        sendResponseSse(res, 'response.output_item.done', {
                            type: 'response.output_item.done',
                            output_index: outputIndex,
                            item: {
                                type: 'message',
                                id: currentItemId,
                                status: 'completed',
                                role: 'assistant',
                                content: [{ type: 'output_text', text: accumulatedText, annotations: [] }]
                            }
                        });
                        sendResponseSse(res, 'response.completed', {
                            type: 'response.completed',
                            response: {
                                id: responseId,
                                object: 'response',
                                status: 'completed',
                                model: modelName,
                                output: outputItems,
                                usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 }
                            }
                        });
                    }
                    continue;
                }

                try {
                    const chunk = JSON.parse(payload);
                    const choice = chunk.choices?.[0];
                    if (!choice) continue;

                    const content = choice.delta?.content;
                    const reasoningContent = choice.delta?.reasoning_content;

                    if (!hasStarted && (content || reasoningContent)) {
                        hasStarted = true;
                        currentItemId = 'msg_' + crypto.randomUUID().replace(/-/g, '').slice(0, 24);
                        // 发送 response.created
                        sendResponseSse(res, 'response.created', {
                            type: 'response.created',
                            response: {
                                id: responseId,
                                object: 'response',
                                status: 'in_progress',
                                model: modelName
                            }
                        });
                        // 发送 output_item.added
                        sendResponseSse(res, 'response.output_item.added', {
                            type: 'response.output_item.added',
                            output_index: outputIndex,
                            item: { type: 'message', id: currentItemId, status: 'in_progress', role: 'assistant', content: [] }
                        });
                        sendResponseSse(res, 'response.content_part.added', {
                            type: 'response.content_part.added',
                            item_id: currentItemId,
                            output_index: outputIndex,
                            content_index: contentIndex,
                            part: { type: 'output_text', text: '', annotations: [] }
                        });
                    }

                    if (content) {
                        accumulatedText += content;
                        sendResponseSse(res, 'response.output_text.delta', {
                            type: 'response.output_text.delta',
                            item_id: currentItemId,
                            output_index: outputIndex,
                            content_index: contentIndex,
                            delta: content
                        });
                    }

                    if (reasoningContent) {
                        accumulatedReasoning += reasoningContent;
                        sendResponseSse(res, 'response.reasoning_text.delta', {
                            type: 'response.reasoning_text.delta',
                            item_id: currentItemId,
                            output_index: outputIndex,
                            content_index: contentIndex,
                            delta: reasoningContent
                        });
                    }

                    if (choice.finish_reason === 'stop' && hasStarted && !doneSent) {
                        doneSent = true;
                        // 构建 output 内容
                        const outputItems = [];
                        if (accumulatedReasoning) {
                            outputItems.push({
                                type: 'reasoning',
                                id: 'rs_' + crypto.randomUUID().replace(/-/g, '').slice(0, 24),
                                status: 'completed',
                                summary: [],
                                content: [{ type: 'reasoning_text', text: accumulatedReasoning }]
                            });
                        }
                        outputItems.push({
                            type: 'message',
                            id: currentItemId,
                            status: 'completed',
                            role: 'assistant',
                            content: [{ type: 'output_text', text: accumulatedText, annotations: [] }]
                        });

                        sendResponseSse(res, 'response.content_part.done', {
                            type: 'response.content_part.done',
                            item_id: currentItemId,
                            output_index: outputIndex,
                            content_index: contentIndex,
                            part: { type: 'output_text', text: accumulatedText, annotations: [] }
                        });
                        sendResponseSse(res, 'response.output_item.done', {
                            type: 'response.output_item.done',
                            output_index: outputIndex,
                            item: {
                                type: 'message',
                                id: currentItemId,
                                status: 'completed',
                                role: 'assistant',
                                content: [{ type: 'output_text', text: accumulatedText, annotations: [] }]
                            }
                        });
                        sendResponseSse(res, 'response.completed', {
                            type: 'response.completed',
                            response: {
                                id: responseId,
                                object: 'response',
                                status: 'completed',
                                model: modelName,
                                output: outputItems,
                                usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 }
                            }
                        });
                    }
                } catch {
                    // 忽略解析错误
                }
            }

            return true;
        },

        end(data) {
            if (res.writableEnded) return;

            if (!isStreaming && data) {
                // 非流式模式：拦截 sendJson 的响应并转换
                try {
                    const chatResponse = JSON.parse(data.toString());
                    const content = chatResponse.choices?.[0]?.message?.content || '';
                    const reasoning = chatResponse.choices?.[0]?.message?.reasoning_content;
                    const responsesOutput = buildResponsesOutput(content, modelName, reasoning);

                    // writeHead 已经被 sendJson 调用过，直接写入转换后的数据
                    res.end(JSON.stringify(responsesOutput));
                    return;
                } catch {
                    // 解析失败，直接返回原始数据
                    return res.end(data);
                }
            }

            return res.end(data);
        }
    };
}
