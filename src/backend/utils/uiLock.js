/**
 * @fileoverview UI 交互锁模块
 * @description 用于解决同一浏览器实例下多 Worker 并发 UI 操作的冲突问题
 *
 * 问题背景：
 * - WebAI2API 使用 ghost-cursor 模拟拟人化鼠标轨迹
 * - 同一浏览器实例下多个 Worker 并发操作时，鼠标移动和点击会相互干扰
 * - 导致 CLICK_TIMEOUT 等错误
 *
 * 解决方案：
 * - 在 UI 交互阶段（输入、点击）加锁，确保同一时间只有一个 Worker 进行 UI 操作
 * - 生成/等待响应阶段不需要锁，可以并行执行
 */

import { logger } from '../../utils/logger.js';

/**
 * 简单的异步互斥锁实现
 */
class AsyncMutex {
    constructor() {
        this._locked = false;
        this._waiting = [];
    }

    /**
     * 获取锁
     * @returns {Promise<void>}
     */
    async acquire() {
        if (!this._locked) {
            this._locked = true;
            return;
        }

        // 已被锁定，加入等待队列
        return new Promise(resolve => {
            this._waiting.push(resolve);
        });
    }

    /**
     * 释放锁
     */
    release() {
        if (this._waiting.length > 0) {
            // 唤醒下一个等待者
            const next = this._waiting.shift();
            next();
        } else {
            this._locked = false;
        }
    }

    /**
     * 检查是否被锁定
     * @returns {boolean}
     */
    isLocked() {
        return this._locked;
    }
}

// 每个浏览器实例一个锁
const instanceLocks = new Map();

/**
 * 获取指定实例的 UI 锁
 * @param {string} instanceName - 浏览器实例名称
 * @returns {AsyncMutex}
 */
function getInstanceLock(instanceName) {
    const key = instanceName || 'default';
    if (!instanceLocks.has(key)) {
        instanceLocks.set(key, new AsyncMutex());
    }
    return instanceLocks.get(key);
}

/**
 * 在持有 UI 锁的情况下执行操作
 * @param {string} instanceName - 浏览器实例名称
 * @param {Function} fn - 要执行的异步函数
 * @param {object} [meta={}] - 日志元数据
 * @returns {Promise<any>} 执行结果
 */
export async function withUILock(instanceName, fn, meta = {}) {
    const lock = getInstanceLock(instanceName);
    const key = instanceName || 'default';

    if (lock.isLocked()) {
        logger.debug('UI锁', `[${key}] 等待获取锁...`, meta);
    }

    await lock.acquire();
    logger.debug('UI锁', `[${key}] 已获取锁`, meta);

    try {
        return await fn();
    } finally {
        lock.release();
        logger.debug('UI锁', `[${key}] 已释放锁`, meta);
    }
}

/**
 * 清理指定实例的锁（用于实例销毁时）
 * @param {string} instanceName - 浏览器实例名称
 */
export function clearInstanceLock(instanceName) {
    const key = instanceName || 'default';
    instanceLocks.delete(key);
}

export { getInstanceLock, AsyncMutex };
