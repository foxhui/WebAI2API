/**
 * @fileoverview 适配器注册表
 * @description 自动扫描 adapter/ 目录，加载所有适配器的 manifest，提供统一查询接口。
 *
 * 设计目标：
 * - 新增适配器只需在 adapter/ 目录添加文件，无需修改框架代码
 * - 提供模型查询、策略查询、导航处理器聚合等统一接口
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';

// 获取当前目录
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ADAPTER_DIR = path.join(__dirname, 'adapter');

/**
 * 图片输入策略枚举
 */
export const IMAGE_POLICY = {
    OPTIONAL: 'optional',
    REQUIRED: 'required',
    FORBIDDEN: 'forbidden'
};

/**
 * 适配器注册表类
 */
class AdapterRegistry {
    constructor() {
        /** @type {Map<string, object>} */
        this.adapters = new Map();
        this.loaded = false;
    }

    /**
     * 扫描并加载所有适配器
     */
    async loadAll() {
        if (this.loaded) return;

        //logger.info('注册表', `正在扫描适配器目录: ${ADAPTER_DIR}`);
        logger.info('注册表', `正在扫描适配器目录...`);

        const files = fs.readdirSync(ADAPTER_DIR).filter(f => f.endsWith('.js'));

        for (const file of files) {
            const filePath = path.join(ADAPTER_DIR, file);
            try {
                const module = await import(`file://${filePath}`);

                if (!module.manifest) {
                    logger.warn('注册表', `跳过 ${file}: 未导出 manifest`);
                    continue;
                }

                const manifest = module.manifest;

                // 校验必需字段
                if (!this.validateManifest(manifest, file)) {
                    continue;
                }

                this.adapters.set(manifest.id, manifest);
                logger.debug('注册表', `已加载适配器: ${manifest.id} (${manifest.displayName || file})`);

            } catch (err) {
                logger.error('注册表', `加载 ${file} 失败: ${err.message}`);
            }
        }

        this.loaded = true;
        logger.info('注册表', `适配器加载完成，共 ${this.adapters.size} 个可用`);
    }

    /**
     * 校验 manifest 必需字段
     * @param {object} manifest
     * @param {string} fileName
     * @returns {boolean}
     */
    validateManifest(manifest, fileName) {
        const errors = [];

        if (!manifest.id || typeof manifest.id !== 'string') {
            errors.push('缺少 id 或类型不正确');
        }

        if (!manifest.generate || typeof manifest.generate !== 'function') {
            errors.push('缺少 generate 函数');
        }

        if (!manifest.models || !Array.isArray(manifest.models)) {
            errors.push('缺少 models 数组');
        } else {
            for (let i = 0; i < manifest.models.length; i++) {
                const m = manifest.models[i];
                if (!m.id) {
                    errors.push(`models[${i}] 缺少 id`);
                }
                if (!m.imagePolicy || !Object.values(IMAGE_POLICY).includes(m.imagePolicy)) {
                    errors.push(`models[${i}] imagePolicy 无效`);
                }
            }
        }

        if (errors.length > 0) {
            logger.error('注册表', `${fileName} manifest 校验失败: ${errors.join('; ')}`);
            return false;
        }

        return true;
    }

    /**
     * 获取适配器
     * @param {string} id - 适配器 ID
     * @returns {object|null}
     */
    getAdapter(id) {
        return this.adapters.get(id) || null;
    }

    /**
     * 获取所有已注册的适配器 ID
     * @returns {string[]}
     */
    getAdapterIds() {
        return Array.from(this.adapters.keys());
    }

    /**
     * 检查适配器是否存在
     * @param {string} id
     * @returns {boolean}
     */
    hasAdapter(id) {
        return this.adapters.has(id);
    }

    /**
     * 获取适配器的目标 URL
     * @param {string} id - 适配器 ID
     * @param {object} config - 全局配置
     * @param {object} workerConfig - Worker 配置
     * @returns {string}
     */
    getTargetUrl(id, config, workerConfig) {
        const adapter = this.getAdapter(id);
        if (!adapter) return 'about:blank';

        if (typeof adapter.getTargetUrl === 'function') {
            return adapter.getTargetUrl(config, workerConfig) || 'about:blank';
        }

        return adapter.targetUrl || 'about:blank';
    }

    /**
     * 获取适配器的导航处理器
     * @param {string} id - 适配器 ID
     * @returns {Function[]}
     */
    getNavigationHandlers(id) {
        const adapter = this.getAdapter(id);
        if (!adapter) return [];
        return adapter.navigationHandlers || [];
    }

    /**
     * 获取适配器的输入框就绪校验函数
     * @param {string} id - 适配器 ID
     * @returns {Function|null}
     */
    getWaitInput(id) {
        const adapter = this.getAdapter(id);
        if (!adapter) return null;
        return adapter.waitInput || null;
    }

    /**
     * 获取指定适配器的模型列表 (OpenAI 格式)
     * @param {string} id - 适配器 ID
     * @returns {object}
     */
    getModelsForAdapter(id) {
        const adapter = this.getAdapter(id);
        if (!adapter || !adapter.models) {
            return { object: 'list', data: [] };
        }

        const data = adapter.models.map(m => ({
            id: m.id,
            object: 'model',
            created: Math.floor(Date.now() / 1000),
            owned_by: id,
            image_policy: m.imagePolicy,
            type: m.type || 'image' // Default to image if not specified
        }));

        return { object: 'list', data };
    }

    /**
     * 检查适配器是否支持指定模型
     * @param {string} adapterId - 适配器 ID
     * @param {string} modelId - 模型 ID
     * @returns {boolean}
     */
    supportsModel(adapterId, modelId) {
        const adapter = this.getAdapter(adapterId);
        if (!adapter?.models) return false;
        return adapter.models.some(m => m.id === modelId);
    }

    /**
     * 解析模型 ID（保留用于向后兼容）
     * @param {string} adapterId - 适配器 ID
     * @param {string} modelKey - 模型 key
     * @returns {string|null} codeName，或 null
     * @deprecated 新架构下适配器自己解析，此方法主要用于向后兼容
     */
    resolveModelId(adapterId, modelKey) {
        const adapter = this.getAdapter(adapterId);
        if (!adapter) return null;

        // 如果适配器还提供了 resolveModelId 函数，调用它
        if (typeof adapter.resolveModelId === 'function') {
            return adapter.resolveModelId(modelKey);
        }

        // 默认行为：查找模型并返回 codeName
        const model = adapter.models.find(m => m.id === modelKey);
        if (model) {
            return model.codeName || model.id;
        }

        return null;
    }

    /**
     * 获取模型的图片策略
     * @param {string} adapterId - 适配器 ID
     * @param {string} modelKey - 模型 key
     * @returns {string}
     */
    getImagePolicy(adapterId, modelKey) {
        const adapter = this.getAdapter(adapterId);
        if (!adapter || !adapter.models) {
            return IMAGE_POLICY.OPTIONAL;
        }

        const model = adapter.models.find(m => m.id === modelKey);
        return model?.imagePolicy || IMAGE_POLICY.OPTIONAL;
    }

    /**
     * 获取模型的类型
     * @param {string} adapterId - 适配器 ID
     * @param {string} modelKey - 模型 key
     * @returns {string} 'text' | 'image'
     */
    getModelType(adapterId, modelKey) {
        const adapter = this.getAdapter(adapterId);
        if (!adapter || !adapter.models) {
            return 'image';
        }

        const model = adapter.models.find(m => m.id === modelKey);
        return model?.type || 'image';
    }

    /**
     * 聚合所有适配器的模型列表
     * @returns {object}
     */
    getAllModels() {
        const allModels = [];

        for (const [id, adapter] of this.adapters) {
            if (adapter.models) {
                for (const m of adapter.models) {
                    allModels.push({
                        id: m.id,
                        object: 'model',
                        created: Math.floor(Date.now() / 1000),
                        owned_by: id,
                        image_policy: m.imagePolicy,
                        type: m.type || 'image'
                    });
                }
            }
        }

        return { object: 'list', data: allModels };
    }
}

// 导出单例
const registry = new AdapterRegistry();

export { AdapterRegistry, registry };
