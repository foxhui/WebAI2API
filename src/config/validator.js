/**
 * @fileoverview 配置校验模块
 * @description 对前端提交的配置进行严格校验
 */

import { registry } from '../backend/registry.js';

/**
 * 校验 Server 配置
 * @param {object} data - 服务器配置
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateServerConfig(data) {
    const errors = [];

    // 端口校验
    if (data.port !== undefined) {
        if (typeof data.port !== 'number' || !Number.isInteger(data.port)) {
            errors.push('port 必须是整数');
        } else if (data.port < 1 || data.port > 65535) {
            errors.push('port 必须在 1-65535 范围内');
        }
    }

    // Auth Token 校验
    if (data.authToken !== undefined) {
        if (typeof data.authToken !== 'string') {
            errors.push('authToken 必须是字符串');
        } else if (data.authToken.length < 10) {
            errors.push('authToken 必须至少 10 个字符');
        }
    }

    // Keepalive Mode 校验
    if (data.keepaliveMode !== undefined) {
        if (!['comment', 'content'].includes(data.keepaliveMode)) {
            errors.push('keepaliveMode 必须是 comment 或 content');
        }
    }

    // Queue Buffer 校验
    if (data.queueBuffer !== undefined) {
        if (typeof data.queueBuffer !== 'number' || !Number.isInteger(data.queueBuffer)) {
            errors.push('queueBuffer 必须是整数');
        } else if (data.queueBuffer < 0) {
            errors.push('queueBuffer 不能为负数');
        }
    }

    // Image Limit 校验
    if (data.imageLimit !== undefined) {
        if (typeof data.imageLimit !== 'number' || !Number.isInteger(data.imageLimit)) {
            errors.push('imageLimit 必须是整数');
        } else if (data.imageLimit < 1 || data.imageLimit > 10) {
            errors.push('imageLimit 必须在 1-10 范围内');
        }
    }

    return { valid: errors.length === 0, errors };
}

/**
 * 校验 Browser 配置
 * @param {object} data - 浏览器配置
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateBrowserConfig(data) {
    const errors = [];

    // Path 校验（可选，字符串）
    if (data.path !== undefined && typeof data.path !== 'string') {
        errors.push('path 必须是字符串');
    }

    // Headless 校验
    if (data.headless !== undefined && typeof data.headless !== 'boolean') {
        errors.push('headless 必须是布尔值');
    }

    // Fission 校验
    if (data.fission !== undefined && typeof data.fission !== 'boolean') {
        errors.push('fission 必须是布尔值');
    }

    // Proxy 校验
    if (data.proxy) {
        if (data.proxy.enable !== undefined && typeof data.proxy.enable !== 'boolean') {
            errors.push('proxy.enable 必须是布尔值');
        }
        if (data.proxy.type !== undefined && !['http', 'socks5'].includes(data.proxy.type)) {
            errors.push('proxy.type 必须是 http 或 socks5');
        }
        if (data.proxy.port !== undefined) {
            if (typeof data.proxy.port !== 'number' || !Number.isInteger(data.proxy.port)) {
                errors.push('proxy.port 必须是整数');
            } else if (data.proxy.port < 1 || data.proxy.port > 65535) {
                errors.push('proxy.port 必须在 1-65535 范围内');
            }
        }
    }

    return { valid: errors.length === 0, errors };
}

/**
 * 校验 Instances 配置
 * @param {object[]} data - 实例配置列表
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateInstancesConfig(data) {
    const errors = [];

    if (!Array.isArray(data)) {
        return { valid: false, errors: ['instances 必须是数组'] };
    }

    if (data.length === 0) {
        return { valid: false, errors: ['instances 不能为空'] };
    }

    const instanceNames = new Set();
    const workerNames = new Set();

    // 获取有效的适配器类型列表
    const validAdapterTypes = new Set(registry.getAdapterIds());
    validAdapterTypes.add('merge'); // merge 是特殊类型

    for (let i = 0; i < data.length; i++) {
        const inst = data[i];
        const prefix = `instances[${i}]`;

        // Instance 名称校验
        if (!inst.name || typeof inst.name !== 'string') {
            errors.push(`${prefix}: name 是必填字段且必须是字符串`);
        } else if (inst.name.trim() === '') {
            errors.push(`${prefix}: name 不能为空`);
        } else if (instanceNames.has(inst.name)) {
            errors.push(`${prefix}: Instance 名称 "${inst.name}" 重复`);
        } else {
            instanceNames.add(inst.name);
        }

        // userDataMark 校验（可选，可为空）
        if (inst.userDataMark !== undefined && inst.userDataMark !== null && inst.userDataMark !== '') {
            if (typeof inst.userDataMark !== 'string') {
                errors.push(`${prefix}: userDataMark 必须是字符串`);
            } else if (!/^[a-zA-Z0-9_-]+$/.test(inst.userDataMark)) {
                errors.push(`${prefix}: userDataMark 只能包含字母、数字、下划线和连字符`);
            }
        }

        // Proxy 校验（可选）
        if (inst.proxy) {
            if (inst.proxy.enable !== undefined && typeof inst.proxy.enable !== 'boolean') {
                errors.push(`${prefix}.proxy: enable 必须是布尔值`);
            }
            if (inst.proxy.type !== undefined && !['http', 'socks5'].includes(inst.proxy.type)) {
                errors.push(`${prefix}.proxy: type 必须是 http 或 socks5`);
            }
            if (inst.proxy.port !== undefined) {
                if (typeof inst.proxy.port !== 'number') {
                    errors.push(`${prefix}.proxy: port 必须是数字`);
                } else if (inst.proxy.port < 1 || inst.proxy.port > 65535) {
                    errors.push(`${prefix}.proxy: port 必须在 1-65535 范围内`);
                }
            }
        }

        // Workers 校验
        if (!inst.workers || !Array.isArray(inst.workers)) {
            errors.push(`${prefix}: workers 是必填字段且必须是数组`);
        } else if (inst.workers.length === 0) {
            errors.push(`${prefix}: workers 不能为空`);
        } else {
            for (let j = 0; j < inst.workers.length; j++) {
                const w = inst.workers[j];
                const wPrefix = `${prefix}.workers[${j}]`;

                // Worker 名称校验
                if (!w.name || typeof w.name !== 'string') {
                    errors.push(`${wPrefix}: name 是必填字段`);
                } else if (w.name.trim() === '') {
                    errors.push(`${wPrefix}: name 不能为空`);
                } else if (workerNames.has(w.name)) {
                    errors.push(`${wPrefix}: Worker 名称 "${w.name}" 全局重复（Worker 名称必须全局唯一）`);
                } else {
                    workerNames.add(w.name);
                }

                // Worker type 校验
                if (!w.type || typeof w.type !== 'string') {
                    errors.push(`${wPrefix}: type 是必填字段`);
                } else if (!validAdapterTypes.has(w.type)) {
                    errors.push(`${wPrefix}: type "${w.type}" 不是有效的适配器类型`);
                }

                // merge 类型特殊校验
                if (w.type === 'merge') {
                    if (!w.mergeTypes || !Array.isArray(w.mergeTypes) || w.mergeTypes.length === 0) {
                        errors.push(`${wPrefix}: merge 类型必须指定 mergeTypes 数组`);
                    } else {
                        for (const mt of w.mergeTypes) {
                            if (!validAdapterTypes.has(mt) || mt === 'merge') {
                                errors.push(`${wPrefix}: mergeTypes 中的 "${mt}" 不是有效的适配器类型`);
                            }
                        }
                    }
                    if (w.mergeMonitor && !w.mergeTypes?.includes(w.mergeMonitor)) {
                        errors.push(`${wPrefix}: mergeMonitor "${w.mergeMonitor}" 必须是 mergeTypes 中的一个`);
                    }
                }
            }
        }
    }

    return { valid: errors.length === 0, errors };
}

/**
 * 校验 Pool 配置
 * @param {object} data - Pool 配置
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validatePoolConfig(data) {
    const errors = [];

    // Strategy 校验
    if (data.strategy !== undefined) {
        if (!['least_busy', 'round_robin', 'random'].includes(data.strategy)) {
            errors.push('strategy 必须是 least_busy、round_robin 或 random');
        }
    }

    // Failover 校验
    if (data.failover) {
        if (data.failover.enabled !== undefined && typeof data.failover.enabled !== 'boolean') {
            errors.push('failover.enabled 必须是布尔值');
        }
        if (data.failover.maxRetries !== undefined) {
            if (typeof data.failover.maxRetries !== 'number' || !Number.isInteger(data.failover.maxRetries)) {
                errors.push('failover.maxRetries 必须是整数');
            } else if (data.failover.maxRetries < 0) {
                errors.push('failover.maxRetries 不能为负数');
            }
        }
    }

    return { valid: errors.length === 0, errors };
}

/**
 * 校验 Adapters 配置
 * @param {object} data - 适配器配置
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateAdaptersConfig(data) {
    const errors = [];

    if (typeof data !== 'object' || data === null) {
        return { valid: false, errors: ['adapters 配置必须是对象'] };
    }

    // gemini_biz 配置校验
    if (data.gemini_biz) {
        if (data.gemini_biz.entryUrl !== undefined) {
            if (typeof data.gemini_biz.entryUrl !== 'string') {
                errors.push('gemini_biz.entryUrl 必须是字符串');
            } else if (data.gemini_biz.entryUrl && !data.gemini_biz.entryUrl.startsWith('https://')) {
                errors.push('gemini_biz.entryUrl 必须以 https:// 开头');
            }
        }
    }

    return { valid: errors.length === 0, errors };
}
