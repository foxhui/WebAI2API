/**
 * @fileoverview 错误码表与中文消息映射模块
 * @description 统一定义服务器错误码及其对应的中文消息和 HTTP 状态码
 */

/**
 * 错误类型枚举 (OpenAI 标准)
 * @readonly
 * @enum {string}
 */
export const ERROR_TYPES = {
    /** 无效请求 */
    INVALID_REQUEST: 'invalid_request_error',
    /** 服务器错误 */
    SERVER_ERROR: 'server_error',
    /** 限流错误 */
    RATE_LIMIT: 'rate_limit_error',
};

/**
 * 错误码枚举
 * @readonly
 * @enum {string}
 */
export const ERROR_CODES = {
    /** 未授权（Token 无效或缺失） */
    UNAUTHORIZED: 'UNAUTHORIZED',
    /** 浏览器未初始化 */
    BROWSER_NOT_INITIALIZED: 'BROWSER_NOT_INITIALIZED',
    /** 服务器繁忙（队列已满） */
    SERVER_BUSY: 'SERVER_BUSY',
    /** 请求参数缺少 messages */
    NO_MESSAGES: 'NO_MESSAGES',
    /** messages 中缺少 role=user 的消息 */
    NO_USER_MESSAGES: 'NO_USER_MESSAGES',
    /** 图片数量超过限制 */
    TOO_MANY_IMAGES: 'TOO_MANY_IMAGES',
    /** 模型无效/后端不支持 */
    INVALID_MODEL: 'INVALID_MODEL',
    /** 该模型需要参考图 */
    IMAGE_REQUIRED: 'IMAGE_REQUIRED',
    /** 该模型不支持图片输入 */
    IMAGE_FORBIDDEN: 'IMAGE_FORBIDDEN',
    /** 触发人机验证（reCAPTCHA） */
    RECAPTCHA: 'RECAPTCHA',
    /** 服务器内部错误 */
    INTERNAL_ERROR: 'INTERNAL_ERROR',
    /** 生成失败 */
    GENERATION_FAILED: 'GENERATION_FAILED',
    /** 请求体超过大小限制 */
    PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
};

/**
 * 错误详情映射表
 * @type {Record<string, {message: string, status: number, type: string}>}
 */
const ERROR_DETAILS = {
    [ERROR_CODES.UNAUTHORIZED]: {
        message: '未授权（Token 无效或缺失）',
        status: 401,
        type: ERROR_TYPES.INVALID_REQUEST,
    },
    [ERROR_CODES.BROWSER_NOT_INITIALIZED]: {
        message: '浏览器未初始化',
        status: 503,
        type: ERROR_TYPES.SERVER_ERROR,
    },
    [ERROR_CODES.SERVER_BUSY]: {
        message: '服务器繁忙（队列已满）',
        status: 429,
        type: ERROR_TYPES.RATE_LIMIT,
    },
    [ERROR_CODES.NO_MESSAGES]: {
        message: '请求参数缺少 messages',
        status: 400,
        type: ERROR_TYPES.INVALID_REQUEST,
    },
    [ERROR_CODES.NO_USER_MESSAGES]: {
        message: 'messages 中缺少 role=user 的消息',
        status: 400,
        type: ERROR_TYPES.INVALID_REQUEST,
    },
    [ERROR_CODES.TOO_MANY_IMAGES]: {
        message: '图片数量超过限制',
        status: 400,
        type: ERROR_TYPES.INVALID_REQUEST,
    },
    [ERROR_CODES.INVALID_MODEL]: {
        message: '模型无效/后端不支持',
        status: 400,
        type: ERROR_TYPES.INVALID_REQUEST,
    },
    [ERROR_CODES.IMAGE_REQUIRED]: {
        message: '该模型需要参考图',
        status: 400,
        type: ERROR_TYPES.INVALID_REQUEST,
    },
    [ERROR_CODES.IMAGE_FORBIDDEN]: {
        message: '该模型不支持图片输入',
        status: 400,
        type: ERROR_TYPES.INVALID_REQUEST,
    },
    [ERROR_CODES.RECAPTCHA]: {
        message: '触发人机验证（reCAPTCHA）',
        status: 403,
        type: ERROR_TYPES.SERVER_ERROR,
    },
    [ERROR_CODES.INTERNAL_ERROR]: {
        message: '服务器内部错误',
        status: 500,
        type: ERROR_TYPES.SERVER_ERROR,
    },
    [ERROR_CODES.GENERATION_FAILED]: {
        message: '图片生成失败',
        status: 502,
        type: ERROR_TYPES.SERVER_ERROR,
    },
    [ERROR_CODES.PAYLOAD_TOO_LARGE]: {
        message: '请求体超过大小限制',
        status: 413,
        type: ERROR_TYPES.INVALID_REQUEST,
    },
};

/**
 * 获取错误消息
 * @param {string} code - 错误码
 * @returns {string} 中文错误消息
 */
export function getErrorMessage(code) {
    return ERROR_DETAILS[code]?.message || '未知错误';
}

/**
 * 获取错误对应的 HTTP 状态码
 * @param {string} code - 错误码
 * @returns {number} HTTP 状态码
 */
export function getErrorStatus(code) {
    return ERROR_DETAILS[code]?.status || 500;
}

/**
 * 获取完整的错误详情
 * @param {string} code - 错误码
 * @returns {{message: string, status: number}} 错误详情
 */
export function getErrorDetails(code) {
    return ERROR_DETAILS[code] || { message: '未知错误', status: 500 };
}

// ==========================================
// 适配器层错误码（从 constants.js 统一到此处）
// ==========================================

/**
 * 适配器错误码
 * @readonly
 */
export const ADAPTER_ERRORS = {
    /** 页面已关闭 */
    PAGE_CLOSED: 'PAGE_CLOSED',

    /** 页面崩溃 */
    PAGE_CRASHED: 'PAGE_CRASHED',

    /** 页面状态无效 */
    PAGE_INVALID: 'PAGE_INVALID',

    /** 网络错误 */
    NETWORK_ERROR: 'NETWORK_ERROR',

    /** 超时错误 */
    TIMEOUT_ERROR: 'TIMEOUT_ERROR',

    /** HTTP 错误 */
    HTTP_ERROR: 'HTTP_ERROR',

    /** 限流 */
    RATE_LIMITED: 'RATE_LIMITED',

    /** 需要验证码 */
    CAPTCHA_REQUIRED: 'CAPTCHA_REQUIRED',

    /** 需要登录 */
    AUTH_REQUIRED: 'AUTH_REQUIRED',

    /** 内容被阻止 (API/页面检测到错误关键词) */
    CONTENT_BLOCKED: 'CONTENT_BLOCKED',
};

