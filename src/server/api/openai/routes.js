/**
 * @fileoverview OpenAI 兼容 API 路由
 * @description 处理 /v1 路径下的所有 API 请求
 */

import crypto from 'crypto';
import { logger } from '../../../utils/logger.js';
import { ERROR_CODES } from '../../errors.js';
import {
    sendJson,
    sendApiError,
    sendAgentError
} from '../../respond.js';
import { parseRequest } from './parse.js';
import {
    ConversationStore,
    createResponseId,
    isOpenAIChatAgentRequest,
    normalizeOpenAIChatRequest,
    normalizeOpenAIResponsesRequest
} from '../../../agent/index.js';

/**
 * 创建 OpenAI API 路由处理器
 * @param {object} context - 路由上下文
 * @returns {Function} 路由处理函数
 */
export function createOpenAIRouter(context) {
    const {
        backendName,
        getModels,
        getImagePolicy,
        getModelType,
        tempDir,
        imageLimit,
        queueManager,
        config,
        conversationStore: providedConversationStore
    } = context;

    const conversationStore = providedConversationStore || new ConversationStore({
        ttlMs: config?.agentCompatibility?.conversationTtlMs,
        maxEntries: config?.agentCompatibility?.maxStoredResponses
    });

    function setSseHeaders(res) {
        if (res.headersSent) return;
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        });
    }

    function sendAgentRouteError(res, error, isStreaming, protocol) {
        if (isStreaming) setSseHeaders(res);
        sendAgentError(res, error, { isStreaming, protocol });
    }

    async function readJsonBody(req) {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const body = Buffer.concat(chunks).toString();
        try {
            return JSON.parse(body);
        } catch (error) {
            const parseError = new Error(`请求体不是有效 JSON: ${error.message}`);
            parseError.status = 400;
            parseError.code = 'AGENT_INVALID_REQUEST';
            throw parseError;
        }
    }

    /**
     * 处理 GET /v1/models
     */
    function handleModels(res) {
        const models = getModels();
        sendJson(res, 200, models);
    }

    /**
     * 处理 GET /v1/cookies
     */
    async function handleCookies(res, requestId, workerName, domain) {
        const poolContext = queueManager.getPoolContext();

        if (!poolContext?.poolManager) {
            sendApiError(res, { code: ERROR_CODES.BROWSER_NOT_INITIALIZED });
            return;
        }

        try {
            const result = await queueManager.getWorkerCookies(workerName, domain);
            sendJson(res, 200, {
                worker: result.worker,
                cookies: result.cookies
            });
        } catch (err) {
            logger.error('服务器', '获取 Cookies 失败', { id: requestId, error: err.message });

            if (err.message.includes('Worker 不存在') || err.message.includes('Worker not found')) {
                sendApiError(res, {
                    code: ERROR_CODES.INVALID_MODEL,
                    message: err.message
                });
            } else {
                sendApiError(res, {
                    code: ERROR_CODES.INTERNAL_ERROR,
                    message: err.message
                });
            }
        }
    }

    /**
     * 处理 POST /v1/chat/completions
     */
    async function handleChatCompletions(req, res, requestId) {
        try {
            const data = await readJsonBody(req);
            const isStreaming = data.stream === true;

            // 限流检查
            if (!isStreaming && !queueManager.canAcceptNonStreaming()) {
                const status = queueManager.getStatus();
                logger.warn('服务器', '非流式请求被拒绝 (队列已满)', { id: requestId, queueSize: status.total });
                sendApiError(res, {
                    code: ERROR_CODES.SERVER_BUSY,
                    message: `服务器繁忙（队列: ${status.total}/${queueManager.maxQueueSize}）。请使用流式模式 (stream: true) 或稍后重试。`
                });
                return;
            }

            if (isOpenAIChatAgentRequest(data)) {
                if (config?.agentCompatibility?.enabled !== true) {
                    const error = new Error('Agent Tool Calling 兼容层未启用；请在 agentCompatibility.enabled=true 后重试');
                    error.code = 'AGENT_COMPATIBILITY_DISABLED';
                    error.status = 400;
                    sendAgentRouteError(res, error, isStreaming, 'openai_chat');
                    return;
                }

                try {
                    const agentRequest = normalizeOpenAIChatRequest(data, {
                        requestId,
                        backendName,
                        getSupportedModels: getModels,
                        getModelType
                    });

                    if (isStreaming) setSseHeaders(res);
                    logger.info('服务器', '[Agent] Chat 请求入队', {
                        id: requestId,
                        model: agentRequest.model,
                        toolCount: agentRequest.tools.length,
                        stream: isStreaming
                    });
                    queueManager.addTask({
                        req,
                        res,
                        prompt: '',
                        imagePaths: [],
                        modelId: agentRequest.model,
                        modelName: agentRequest.model,
                        id: requestId,
                        isStreaming,
                        reasoning: data.reasoning === true,
                        agentRequest,
                        agentProtocol: 'openai_chat'
                    });
                } catch (error) {
                    logger.warn('服务器', '[Agent] Chat 请求校验失败', {
                        id: requestId,
                        code: error.code || 'AGENT_INVALID_REQUEST'
                    });
                    sendAgentRouteError(res, error, isStreaming, 'openai_chat');
                }
                return;
            }

            // 设置 SSE 响应头
            if (isStreaming) setSseHeaders(res);

            // 解析请求
            const parseResult = await parseRequest(data, {
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
                sendApiError(res, {
                    code: parseResult.error.code,
                    message: parseResult.error.error,
                    isStreaming
                });
                return;
            }

            const { prompt, imagePaths, modelId, modelName } = parseResult.data;
            const reasoning = data.reasoning === true;

            logger.info('服务器', `[队列] 请求入队: ${prompt.slice(0, 100)}...`, { id: requestId, images: imagePaths.length });

            // 加入队列
            queueManager.addTask({
                req,
                res,
                prompt,
                imagePaths,
                modelId,
                modelName,
                id: requestId,
                isStreaming,
                reasoning
            });

        } catch (err) {
            logger.error('服务器', '请求处理失败', { id: requestId, error: err.message });
            sendApiError(res, {
                code: ERROR_CODES.INTERNAL_ERROR,
                message: err.message
            });
        }
    }

    /**
     * 处理 POST /v1/responses（最小、带 TTL 的 Responses API）
     */
    async function handleResponses(req, res, requestId) {
        let data;
        try {
            data = await readJsonBody(req);
        } catch (error) {
            sendAgentRouteError(res, error, false, 'openai_responses');
            return;
        }
        const isStreaming = data.stream === true;

        if (config?.agentCompatibility?.enabled !== true) {
            const error = new Error('Agent Tool Calling 兼容层未启用；/v1/responses 暂不可用');
            error.code = 'AGENT_COMPATIBILITY_DISABLED';
            error.status = 400;
            sendAgentRouteError(res, error, isStreaming, 'openai_responses');
            return;
        }
        if (!isStreaming && !queueManager.canAcceptNonStreaming()) {
            const status = queueManager.getStatus();
            const error = new Error(`服务器繁忙（队列: ${status.total}/${queueManager.maxQueueSize}）`);
            error.code = ERROR_CODES.SERVER_BUSY;
            error.status = 429;
            sendApiError(res, { code: ERROR_CODES.SERVER_BUSY, message: error.message });
            return;
        }

        try {
            const agentRequest = normalizeOpenAIResponsesRequest(data, {
                requestId,
                backendName,
                getSupportedModels: getModels,
                getModelType,
                conversationStore
            });
            const responseId = createResponseId();
            if (isStreaming) setSseHeaders(res);
            logger.debug('服务器', '[Agent] Responses 请求入队', {
                id: requestId,
                responseId,
                model: agentRequest.model,
                toolCount: agentRequest.tools.length,
                toolChoice: agentRequest.toolChoice,
                itemTypes: agentRequest.items.map(item => item.type),
                previousResponseId: agentRequest.metadata.previousResponseId || null,
                stream: isStreaming
            });
            queueManager.addTask({
                req,
                res,
                prompt: '',
                imagePaths: [],
                modelId: agentRequest.model,
                modelName: agentRequest.model,
                id: requestId,
                responseId,
                isStreaming,
                reasoning: false,
                agentRequest,
                agentProtocol: 'openai_responses'
            });
        } catch (error) {
            logger.warn('服务器', '[Agent] Responses 请求校验失败', {
                id: requestId,
                code: error.code || 'AGENT_INVALID_REQUEST'
            });
            sendAgentRouteError(res, error, isStreaming, 'openai_responses');
        }
    }

    /**
     * OpenAI API 路由处理函数
     * @param {import('http').IncomingMessage} req
     * @param {import('http').ServerResponse} res
     * @param {string} pathname - 去除 /v1 前缀后的路径
     * @param {URL} parsedUrl - 解析后的 URL 对象
     */
    return async function handleOpenAIRequest(req, res, pathname, parsedUrl) {
        const requestId = crypto.randomUUID().slice(0, 8);

        if (req.method === 'GET' && pathname === '/models') {
            handleModels(res);
        } else if (req.method === 'GET' && pathname === '/cookies') {
            const workerName = parsedUrl.searchParams.get('name');
            const domain = parsedUrl.searchParams.get('domain');
            await handleCookies(res, requestId, workerName, domain);
        } else if (req.method === 'POST' && pathname === '/responses') {
            await handleResponses(req, res, requestId);
        } else if (req.method === 'POST' && pathname.startsWith('/chat/completions')) {
            await handleChatCompletions(req, res, requestId);
        } else {
            res.writeHead(404);
            res.end();
        }
    };
}
