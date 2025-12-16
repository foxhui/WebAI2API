/**
 * @fileoverview 配置加载模块
 * @description 负责读取/解析 `config.yaml`，并提供 API Key 生成能力（供脚本使用）。
 *
 * 约定：
 * - 该模块只负责"读取 + 校验 + 默认值补全"，不负责创建/写入配置文件。
 * - 初始化/拷贝配置请使用 `config.example.yaml` + `scripts/config-init.js`。
 */

import fs from 'fs';
import path from 'path';
import yaml from 'yaml';

import { logger } from './logger.js';

const CONFIG_PATH = path.join(process.cwd(), 'config.yaml');
const EXAMPLE_CONFIG_PATH = path.join(process.cwd(), 'config.example.yaml');

// 模块级缓存：确保配置只从磁盘读取一次
let cachedConfig = null;

/**
 * 解析用户数据目录路径
 * @param {string|undefined} userDataMark - 用户数据标记
 * @returns {string} 完整的用户数据目录路径
 */
function resolveUserDataDir(userDataMark) {
    const baseDir = path.join(process.cwd(), 'data');
    if (!userDataMark) {
        return path.join(baseDir, 'camoufoxUserData');
    }
    return path.join(baseDir, `camoufoxUserData_${userDataMark}`);
}

/**
 * 解析代理配置（Instance 级优先于全局）
 * @param {object|undefined} globalProxy - 全局代理配置
 * @param {object|undefined} instanceProxy - Instance 级代理配置
 * @returns {object|null} 最终代理配置，null 表示直连
 */
function resolveProxyConfig(globalProxy, instanceProxy) {
    // Instance 级显式禁用代理 -> 直连
    if (instanceProxy && instanceProxy.enable === false) {
        return null;
    }
    // Instance 级有配置且启用 -> 使用 Instance 配置
    if (instanceProxy && instanceProxy.enable === true) {
        return instanceProxy;
    }
    // 回退到全局配置
    if (globalProxy && globalProxy.enable === true) {
        return globalProxy;
    }
    return null;
}

/**
 * 校验 Instance 配置
 * @param {object} instance - Instance 配置
 * @param {number} index - Instance 索引
 */
function validateInstance(instance, index) {
    if (!instance.name) {
        throw new Error(`instances[${index}] 缺少必需字段: name`);
    }
    if (!instance.workers || !Array.isArray(instance.workers) || instance.workers.length === 0) {
        throw new Error(`instances[${index}] (${instance.name}) 缺少有效的 workers 数组`);
    }
}

/**
 * 校验 Worker 配置
 * @param {object} worker - Worker 配置
 * @param {string} instanceName - 所属 Instance 名称
 * @param {number} index - Worker 索引
 */
function validateWorker(worker, instanceName, index) {
    if (!worker.name) {
        throw new Error(`instances[${instanceName}].workers[${index}] 缺少必需字段: name`);
    }
    if (!worker.type) {
        throw new Error(`instances[${instanceName}].workers[${index}] (${worker.name}) 缺少必需字段: type`);
    }
    // 移除对 type 的硬编码校验，允许动态加载新适配器
    // if (!VALID_ADAPTER_TYPES.includes(worker.type)) { ... }

    if (worker.type === 'merge') {
        if (!worker.mergeTypes || !Array.isArray(worker.mergeTypes) || worker.mergeTypes.length === 0) {
            throw new Error(`Worker "${worker.name}" 类型为 merge，但缺少有效的 mergeTypes 数组`);
        }
    }
}

/**
 * 展开 instances 配置为扁平化的 workers 数组
 * @param {object[]} instances - instances 配置数组
 * @param {object} globalProxy - 全局代理配置
 * @returns {object[]} 扁平化的 worker 配置数组
 */
function flattenInstancesToWorkers(instances, globalProxy) {
    const workers = [];
    const workerNames = new Set();

    for (let i = 0; i < instances.length; i++) {
        const instance = instances[i];
        validateInstance(instance, i);

        // 解析 Instance 级配置
        const userDataDir = resolveUserDataDir(instance.userDataMark);
        const resolvedProxy = resolveProxyConfig(globalProxy, instance.proxy);

        for (let j = 0; j < instance.workers.length; j++) {
            const worker = instance.workers[j];
            validateWorker(worker, instance.name, j);

            // 检查 Worker 名称全局唯一性
            if (workerNames.has(worker.name)) {
                throw new Error(`Worker 名称 "${worker.name}" 重复。Worker 名称必须全局唯一。`);
            }
            workerNames.add(worker.name);

            // 构建扁平化的 Worker 配置
            workers.push({
                // Worker 自身属性
                name: worker.name,
                type: worker.type,
                mergeTypes: worker.mergeTypes || [],
                mergeMonitor: worker.mergeMonitor || null,

                // 从 Instance 继承的属性
                instanceName: instance.name,
                userDataMark: instance.userDataMark || null,
                userDataDir,
                resolvedProxy
            });
        }
    }

    return workers;
}

/**
 * 加载并校验配置（只读）
 * @returns {object} 配置对象
 */
export function loadConfig() {
    // 如果已有缓存，直接返回
    if (cachedConfig) return cachedConfig;

    if (!fs.existsSync(CONFIG_PATH)) {
        const hint = fs.existsSync(EXAMPLE_CONFIG_PATH)
            ? `请复制 ${EXAMPLE_CONFIG_PATH} 为 ${CONFIG_PATH}`
            : `请创建 ${CONFIG_PATH}（仓库根目录通常提供 config.example.yaml 作为模板）`;
        throw new Error(`未找到配置文件: ${CONFIG_PATH}。${hint}`);
    }

    const configFile = fs.readFileSync(CONFIG_PATH, 'utf8');
    let config = yaml.parse(configFile);
    if (!config || typeof config !== 'object') {
        throw new Error(`配置文件解析失败: ${CONFIG_PATH}`);
    }

    // Docker 路径兼容处理
    if ((!config.browser?.path || !fs.existsSync(config.browser.path)) &&
        fs.existsSync('/app/camoufox/camoufox')) {
        logger.info('配置器', '检测到容器环境，自动修正浏览器路径为 /app/camoufox/camoufox');
        if (!config.browser) config.browser = {};
        config.browser.path = '/app/camoufox/camoufox';
    }

    // 基础配置校验
    if (!config.server || !config.server.port) {
        throw new Error('配置文件缺少必需字段: server.port');
    }
    // 端口类型和范围校验
    const port = config.server.port;
    if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(`server.port 必须是 1-65535 范围内的整数，当前值: ${port}`);
    }
    if (!config.server.auth) {
        throw new Error('配置文件缺少必需字段: server.auth');
    }
    if (typeof config.server.auth !== 'string' || config.server.auth.length < 10) {
        throw new Error('server.auth 必须是至少 10 个字符的字符串 (建议使用 npm run genkey 生成)');
    }

    // 设置 keepalive 配置默认值
    if (!config.server.keepalive) {
        config.server.keepalive = { mode: 'comment' };
    } else {
        if (config.server.keepalive.mode === undefined) config.server.keepalive.mode = 'comment';
        if (!['comment', 'content'].includes(config.server.keepalive.mode)) {
            logger.warn('配置器', `无效的 keepalive.mode: ${config.server.keepalive.mode}，使用默认值 comment`);
            config.server.keepalive.mode = 'comment';
        }
    }

    // 设置 Pool 配置默认值
    if (!config.backend) config.backend = {};
    if (!config.backend.pool) config.backend.pool = {};

    if (!config.backend.pool.strategy) {
        config.backend.pool.strategy = 'least_busy';
    }
    if (!['least_busy', 'round_robin', 'random'].includes(config.backend.pool.strategy)) {
        logger.warn('配置器', `无效的 pool.strategy: ${config.backend.pool.strategy}，使用默认值 least_busy`);
        config.backend.pool.strategy = 'least_busy';
    }

    // 故障转移配置默认值
    if (!config.backend.pool.failover) {
        config.backend.pool.failover = {};
    }
    if (config.backend.pool.failover.enabled === undefined) {
        config.backend.pool.failover.enabled = true;
    }
    if (config.backend.pool.failover.maxRetries === undefined) {
        config.backend.pool.failover.maxRetries = 2;
    }

    // 校验 instances 配置
    if (!config.backend.pool.instances || !Array.isArray(config.backend.pool.instances)) {
        throw new Error('配置文件缺少必需字段: backend.pool.instances');
    }
    if (config.backend.pool.instances.length === 0) {
        throw new Error('backend.pool.instances 不能为空数组');
    }

    // 展开 instances 为扁平化的 workers 数组
    config.backend.pool.workers = flattenInstancesToWorkers(
        config.backend.pool.instances,
        config.browser?.proxy
    );

    // 设置队列配置默认值
    if (!config.queue) {
        config.queue = {
            queueBuffer: 2,
            imageLimit: 5
        };
    } else {
        if (config.queue.queueBuffer === undefined) config.queue.queueBuffer = 2;
        if (config.queue.imageLimit === undefined) config.queue.imageLimit = 5;
    }

    // maxConcurrent 动态计算：等于 Workers 数量
    config.queue.maxConcurrent = config.backend.pool.workers.length;

    // 初始化 adapter 配置容器
    if (!config.backend.adapter) {
        config.backend.adapter = {};
    }

    // 校验 gemini_biz 配置（如果有 Worker 使用）
    const hasGeminiBizWorker = config.backend.pool.workers.some(
        w => w.type === 'gemini_biz' || (w.type === 'merge' && w.mergeTypes?.includes('gemini_biz'))
    );
    if (hasGeminiBizWorker && !config.backend.adapter.gemini_biz?.entryUrl) {
        throw new Error('存在 gemini_biz 类型的 Worker，但 backend.adapter.gemini_biz.entryUrl 未配置');
    }

    // 设置日志级别
    if (config.logLevel) {
        logger.setLevel(config.logLevel);
    }

    // 日志输出
    logger.debug('配置器', '已加载 config.yaml');
    logger.debug('配置器', `Instances: ${config.backend.pool.instances.length}, Workers: ${config.backend.pool.workers.length}`);
    logger.debug('配置器', `调度策略: ${config.backend.pool.strategy}`);
    logger.debug('配置器', `流式心跳模式: ${config.server.keepalive.mode}`);

    // 缓存配置
    cachedConfig = config;
    return config;
}

// 导出辅助函数供其他模块使用
export { resolveUserDataDir, resolveProxyConfig };

// 默认导出为函数
export default loadConfig;
