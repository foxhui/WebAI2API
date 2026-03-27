/**
 * @fileoverview 错误归一化模块
 * @description 统一处理页面级和 HTTP 级错误，提供可重试判定
 */

import { logger } from '../../utils/logger.js';
import { ADAPTER_ERRORS } from '../../server/errors.js';

// ==========================================
// 可重试判定
// ==========================================

/**
 * 判断错误是否可重试
 * @param {string} errorMessage - 错误消息
 * @returns {boolean}
 */
export function isRetryableError(errorMessage) {
    if (!errorMessage) return false;

    const retryablePatterns = [
        // 网络错误
        /network|net::|econnreset|econnrefused|etimedout/i,
        // 超时
        /timeout|timed out/i,
        // 页面崩溃
        /crashed|crash/i,
        // 5xx 服务端错误
        /5\d{2}|internal server error|bad gateway|service unavailable/i,
        // 限流（可能是临时的）
        /rate limit|too many requests|429/i,
    ];

    return retryablePatterns.some(pattern => pattern.test(errorMessage));
}

// ==========================================
// 页面错误归一化
// ==========================================

/**
 * 统一处理页面级错误
 * @param {Error} err - 原始错误
 * @param {object} [meta={}] - 日志元数据
 * @returns {{ error: string, code: string, retryable: boolean } | null}
 */
export function normalizePageError(err, meta = {}) {
    if (err.message === 'PAGE_CLOSED') {
        logger.error('适配器', '页面已关闭', meta);
        return { error: '页面已关闭，请勿在生图过程中刷新页面', code: ADAPTER_ERRORS.PAGE_CLOSED, retryable: true };
    }
    if (err.message === 'PAGE_CRASHED') {
        logger.error('适配器', '页面崩溃', meta);
        return { error: '页面崩溃，请重试', code: ADAPTER_ERRORS.PAGE_CRASHED, retryable: true };
    }
    if (err.message === 'PAGE_INVALID') {
        logger.error('适配器', '页面状态无效', meta);
        return { error: '页面状态无效，请重新初始化', code: ADAPTER_ERRORS.PAGE_INVALID, retryable: true };
    }
    // API_TIMEOUT: waitApiResponse 内部转换后的超时错误
    if (err.message?.startsWith('API_TIMEOUT:')) {
        const timeoutMsg = err.message.replace('API_TIMEOUT: ', '');
        logger.error('适配器', timeoutMsg, meta);
        return { error: timeoutMsg, code: ADAPTER_ERRORS.TIMEOUT_ERROR, retryable: true };
    }
    // 兼容原生 TimeoutError (其他地方抛出的)
    if (err.name === 'TimeoutError' || err.message?.includes('Timeout')) {
        logger.error('适配器', '请求超时', meta);
        return { error: '请求超时, 请检查网络或稍后重试', code: ADAPTER_ERRORS.TIMEOUT_ERROR, retryable: true };
    }
    // PAGE_ERROR_DETECTED: waitApiResponse 页面 UI 中检测到的错误关键词
    if (err.message?.startsWith('PAGE_ERROR_DETECTED:')) {
        const keyword = err.message.replace('PAGE_ERROR_DETECTED: ', '');
        logger.error('适配器', `页面检测到错误: ${keyword}`, meta);
        return { error: `内容被阻止: ${keyword}`, code: ADAPTER_ERRORS.CONTENT_BLOCKED, retryable: false };
    }
    // API_ERROR_DETECTED: waitApiResponse API 响应体中检测到的错误关键词
    if (err.message?.startsWith('API_ERROR_DETECTED:')) {
        const keyword = err.message.replace('API_ERROR_DETECTED: ', '');
        logger.error('适配器', `API 响应检测到错误: ${keyword}`, meta);
        return { error: `内容被阻止: ${keyword}`, code: ADAPTER_ERRORS.CONTENT_BLOCKED, retryable: false };
    }
    return null;
}

// ==========================================
// HTTP 错误归一化
// ==========================================

/**
 * 统一处理 HTTP 响应错误
 * @param {import('playwright-core').Response} response - HTTP 响应对象
 * @param {string} [content=null] - 响应体内容（可选）
 * @returns {{ error: string, code: string, retryable: boolean } | null}
 */
export function normalizeHttpError(response, content = null) {
    const status = response.status();

    // 尝试从响应体中提取具体错误信息
    let detailError = null;
    if (content) {
        try {
            const json = JSON.parse(content);
            // 格式: {"error": "Request rejected: ..."}
            if (json.error && typeof json.error === 'string') {
                detailError = json.error;
            }
            // 格式: {"error": {"message": "..."}}
            else if (json.error?.message) {
                detailError = json.error.message;
            }
        } catch {
            // 非 JSON 格式，尝试直接使用内容
            if (content.length < 200) {
                detailError = content;
            }
        }
    }

    // 检查是否是内容审核拒绝 (通常返回 422 或 429 但含有拒绝信息)
    const isContentRejection = detailError && (
        /reject|violat|terms|blocked|forbidden|unsafe|moderat/i.test(detailError) ||
        detailError === 'prompt failed'
    );
    if (isContentRejection) {
        return { error: `内容被拒绝: ${detailError}`, code: ADAPTER_ERRORS.CONTENT_BLOCKED, retryable: false };
    }

    // 429 限流检查
    if (status === 429 || content?.includes('Too Many Requests')) {
        return { error: '触发限流/上游繁忙', code: ADAPTER_ERRORS.RATE_LIMITED, retryable: true };
    }

    // reCAPTCHA 验证失败
    if (content?.includes('recaptcha validation failed')) {
        return { error: '触发人机验证', code: ADAPTER_ERRORS.CAPTCHA_REQUIRED, retryable: false };
    }

    // 5xx 服务端错误（可重试）
    if (status >= 500) {
        const msg = detailError
            ? `上游服务器错误 (${status}): ${detailError}`
            : `上游服务器错误，HTTP错误码: ${status}`;
        return { error: msg, code: ADAPTER_ERRORS.HTTP_ERROR, retryable: true };
    }

    // 4xx 客户端错误（不可重试）
    if (status >= 400) {
        const msg = detailError
            ? `请求被拒绝 (${status}): ${detailError}`
            : `请求错误，HTTP错误码: ${status}`;
        return { error: msg, code: ADAPTER_ERRORS.HTTP_ERROR, retryable: false };
    }

    return null;
}

// ==========================================
// 通用错误归一化
// ==========================================

/**
 * 标准化错误对象（通用）
 * @param {string} error - 错误消息
 * @returns {{error: string, code: string, retryable: boolean}}
 */
export function normalizeError(error) {
    const retryable = isRetryableError(error);

    let code = ADAPTER_ERRORS.NETWORK_ERROR;
    if (/timeout/i.test(error)) {
        code = ADAPTER_ERRORS.TIMEOUT_ERROR;
    } else if (/crashed/i.test(error)) {
        code = ADAPTER_ERRORS.PAGE_CRASHED;
    } else if (/closed/i.test(error)) {
        code = ADAPTER_ERRORS.PAGE_CLOSED;
    } else if (/5\d{2}|internal server/i.test(error)) {
        code = ADAPTER_ERRORS.HTTP_ERROR;
    } else if (/rate limit|429/i.test(error)) {
        code = ADAPTER_ERRORS.RATE_LIMITED;
    } else if (/captcha|recaptcha/i.test(error)) {
        code = ADAPTER_ERRORS.CAPTCHA_REQUIRED;
    }

    return { error, code, retryable };
}
