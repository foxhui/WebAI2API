/**
 * @fileoverview 后端适配器入口
 * @description 基于 Pool 架构统一管理多浏览器实例，提供统一的对外接口。
 *
 * 对外统一能力：
 * - `initBrowser(cfg)` → 初始化 Pool
 * - `generateImage(ctx, prompt, imagePaths, modelId, meta)`
 * - `resolveModelId(modelKey)` / `getModels()` / `getImagePolicy(modelKey)`
 * - `getCookies(workerName, domain)` - 获取指定 Worker 的 Cookies
 */

import fs from 'fs';
import path from 'path';
import { loadConfig } from '../utils/config.js';
import { PoolManager } from './pool/index.js';
import { logger } from '../utils/logger.js';

// --- 集中管理的路径常量 ---
const TEMP_DIR = path.join(process.cwd(), 'data', 'temp');

// 确保临时目录存在
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// 全局 PoolManager 实例
let poolManager = null;

/**
 * 获取后端接口
 * @returns {object} 后端统一接口
 */
export function getBackend() {
    const config = loadConfig();

    // 将临时目录路径注入 config 对象
    config.paths = {
        tempDir: TEMP_DIR
    };

    return {
        name: 'pool',
        config,
        TEMP_DIR,

        /**
         * 初始化 Pool
         * @param {object} cfg - 配置对象
         * @returns {Promise<{poolManager: PoolManager, config: object}>}
         */
        initBrowser: async (cfg) => {
            if (poolManager && poolManager.initialized) {
                return { poolManager, config: cfg };
            }

            poolManager = new PoolManager(cfg);
            await poolManager.initAll();

            return { poolManager, config: cfg };
        },

        /**
         * 生成图片
         * @param {object} ctx - 浏览器上下文 (来自 initBrowser 返回)
         * @param {string} prompt - 提示词
         * @param {string[]} paths - 图片路径
         * @param {string} modelId - 模型 ID
         * @param {object} meta - 元信息
         */
        generateImage: async (ctx, prompt, paths, modelId, meta) => {
            if (!poolManager) {
                return { error: 'Pool 未初始化' };
            }
            return await poolManager.generateImage(ctx, prompt, paths, modelId, meta);
        },

        /**
         * 解析模型 ID
         * @param {string} modelKey - 模型 key
         * @returns {string|null}
         */
        resolveModelId: (modelKey) => {
            if (!poolManager) {
                logger.warn('适配器', 'resolveModelId 调用时 Pool 未初始化');
                return null;
            }
            return poolManager.resolveModelId(modelKey);
        },

        /**
         * 获取模型列表
         * @returns {object}
         */
        getModels: () => {
            if (!poolManager) {
                return { object: 'list', data: [] };
            }
            return poolManager.getModels();
        },

        /**
         * 获取图片策略
         * @param {string} modelKey - 模型 key
         * @returns {string}
         */
        getImagePolicy: (modelKey) => {
            if (!poolManager) {
                return 'optional';
            }
            return poolManager.getImagePolicy(modelKey);
        },

        /**
         * 获取模型类型
         * @param {string} modelKey - 模型 key
         * @returns {string} 'text' | 'image'
         */
        getModelType: (modelKey) => {
            if (!poolManager) {
                return 'image';
            }
            return poolManager.getModelType(modelKey);
        },

        /**
         * 获取 Cookies
         * @param {string} [workerName] - Worker 名称
         * @param {string} [domain] - 域名
         * @returns {Promise<{worker: string, cookies: object[]}>}
         */
        getCookies: async (workerName, domain) => {
            if (!poolManager) {
                throw new Error('Pool 未初始化');
            }
            return await poolManager.getCookies(workerName, domain);
        },

        /**
         * 触发监控导航（空闲时）
         */
        navigateToMonitor: async () => {
            if (poolManager) {
                await poolManager.navigateToMonitor();
            }
        },

        /**
         * 获取 PoolManager 实例
         * @returns {PoolManager|null}
         */
        getPoolManager: () => poolManager
    };
}
