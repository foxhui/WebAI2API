/**
 * @fileoverview Worker 类
 * @description 封装单个浏览器实例，提供模型匹配和任务执行能力
 */

import fs from 'fs';
import { logger } from '../../utils/logger.js';
import { initBrowserBase, createCursor } from '../../browser/launcher.js';
import { registry } from '../registry.js';
import { tryGotoWithCheck } from '../utils/page.js';

/**
 * Worker 类 - 封装单个浏览器实例
 */
export class Worker {
    /**
     * @param {object} globalConfig - 全局配置
     * @param {object} workerConfig - Worker 配置
     */
    constructor(globalConfig, workerConfig) {
        this.name = workerConfig.name;
        this.type = workerConfig.type;
        this.instanceName = workerConfig.instanceName || null;
        this.userDataDir = workerConfig.userDataDir;
        this.proxyConfig = workerConfig.resolvedProxy;
        this.globalConfig = globalConfig;
        this.workerConfig = workerConfig;

        // Merge 模式专属
        this.mergeTypes = workerConfig.mergeTypes || [];
        this.mergeMonitor = workerConfig.mergeMonitor || null;

        // 运行时状态
        this.browser = null;
        this.page = null;
        this.busyCount = 0;
        this.initialized = false;
    }

    /**
     * 初始化浏览器实例
     * @param {object} [sharedBrowser] - 可选，共享的浏览器实例
     */
    async init(sharedBrowser = null) {
        if (this.initialized) return;

        // 确保用户数据目录存在
        if (!fs.existsSync(this.userDataDir)) {
            fs.mkdirSync(this.userDataDir, { recursive: true });
        }

        // 获取目标 URL
        let targetUrl = 'about:blank';
        if (this.type === 'merge') {
            const firstType = this.mergeTypes[0];
            targetUrl = registry.getTargetUrl(firstType, this.globalConfig, this.workerConfig) || 'about:blank';
        } else {
            targetUrl = registry.getTargetUrl(this.type, this.globalConfig, this.workerConfig) || 'about:blank';
        }

        // 收集导航处理器
        const handlers = [];
        const typesToHandle = this.type === 'merge' ? this.mergeTypes : [this.type];
        for (const type of typesToHandle) {
            const typeHandlers = registry.getNavigationHandlers(type);
            handlers.push(...typeHandlers);
        }

        const navigationHandler = handlers.length > 0
            ? async (page) => {
                for (const handler of handlers) {
                    try { await handler(page); } catch (e) { /* ignore */ }
                }
            }
            : null;

        logger.info('工作池', `[${this.name}] 正在初始化浏览器...`);
        if (this.proxyConfig) {
            logger.debug('工作池', `[${this.name}] 使用代理: ${this.proxyConfig.type}://${this.proxyConfig.host}:${this.proxyConfig.port}`);
        } else {
            logger.debug('工作池', `[${this.name}] 直连模式（无代理）`);
        }

        if (sharedBrowser) {
            await this._initWithSharedBrowser(sharedBrowser, targetUrl, navigationHandler);
        } else {
            await this._initNewBrowser(targetUrl, navigationHandler);
        }

        this.initialized = true;
    }

    /**
     * 使用共享浏览器初始化
     * @private
     */
    async _initWithSharedBrowser(sharedBrowser, targetUrl, navigationHandler) {
        logger.info('工作池', `[${this.name}] 复用已有浏览器，创建新标签页...`);
        this.browser = sharedBrowser;
        this.page = await sharedBrowser.newPage();
        this.page.authState = { isHandlingAuth: false };
        this.page.cursor = createCursor(this.page);

        await this._navigateToTarget(targetUrl);

        if (navigationHandler) {
            this.page.on('framenavigated', async () => {
                try { await navigationHandler(this.page); } catch (e) { /* ignore */ }
            });
        }

        logger.info('工作池', `[${this.name}] 初始化完成`);
    }

    /**
     * 启动新浏览器初始化
     * @private
     */
    async _initNewBrowser(targetUrl, navigationHandler) {
        const base = await initBrowserBase(this.globalConfig, {
            userDataDir: this.userDataDir,
            instanceName: this.instanceName,
            proxyConfig: this.proxyConfig
        });

        this.browser = base.context;
        this.page = base.page;
        this.page.authState = { isHandlingAuth: false };
        this.page.cursor = createCursor(this.page);

        if (navigationHandler) {
            this.page.on('framenavigated', async () => {
                try { await navigationHandler(this.page); } catch (e) { /* ignore */ }
            });
        }

        logger.info('工作池', `[${this.name}] 正在连接目标页面...`);
        await this._navigateToTarget(targetUrl);

        // 登录模式处理
        const isLoginMode = process.argv.some(arg => arg.startsWith('-login'));
        if (isLoginMode) {
            logger.info('工作池', `[${this.name}] 登录模式已就绪，请在浏览器中完成登录`);
            logger.info('工作池', `[${this.name}] 完成后可直接关闭浏览器窗口或按 Ctrl+C 退出`);
            await new Promise(resolve => this.browser.on('close', resolve));
            process.exit(0);
        }

        logger.info('工作池', `[${this.name}] 初始化完成`);
    }

    /**
     * 导航到目标 URL
     * @private
     */
    async _navigateToTarget(targetUrl) {
        if (this.type === 'merge') {
            let gotoSuccess = false;
            for (const type of this.mergeTypes) {
                const url = registry.getTargetUrl(type, this.globalConfig, this.workerConfig);
                if (!url) continue;
                const gotoResult = await tryGotoWithCheck(this.page, url, { timeout: 30000 });
                if (!gotoResult.error) {
                    gotoSuccess = true;
                    logger.debug('工作池', `[${this.name}] 使用 ${type} 适配器初始化成功`);
                    break;
                }
                logger.warn('工作池', `[${this.name}] ${type} 网站不可用，尝试下一个...`, { error: gotoResult.error });
            }
            if (!gotoSuccess) {
                logger.warn('工作池', `[${this.name}] 所有适配器网站当前不可用，但 Worker 仍将初始化（请求时可能会失败）`);
            }
        } else {
            const gotoResult = await tryGotoWithCheck(this.page, targetUrl, { timeout: 60000 });
            if (gotoResult.error) {
                logger.warn('工作池', `[${this.name}] 目标网站当前不可用: ${gotoResult.error}，但 Worker 仍将初始化`);
            }
        }
    }

    /**
     * 检查是否支持指定模型
     */
    supports(modelId) {
        if (this.type === 'merge') {
            for (const type of this.mergeTypes) {
                const resolved = registry.resolveModelId(type, modelId);
                if (resolved) return true;
            }
            if (modelId.includes('/')) {
                const [specifiedType] = modelId.split('/', 2);
                return this.mergeTypes.includes(specifiedType);
            }
            return false;
        } else {
            if (modelId.includes('/')) {
                const [specifiedType, actualModel] = modelId.split('/', 2);
                if (specifiedType === this.type) {
                    const resolved = registry.resolveModelId(this.type, actualModel);
                    return !!resolved;
                }
                return false;
            }
            return !!registry.resolveModelId(this.type, modelId);
        }
    }

    /**
     * 解析模型 ID
     */
    resolveModelId(modelKey) {
        if (this.type === 'merge') {
            if (modelKey.includes('/')) {
                const [specifiedType, actualModel] = modelKey.split('/', 2);
                if (this.mergeTypes.includes(specifiedType)) {
                    const realId = registry.resolveModelId(specifiedType, actualModel);
                    if (realId) return { type: specifiedType, realId };
                }
                return null;
            }
            for (const type of this.mergeTypes) {
                const realId = registry.resolveModelId(type, modelKey);
                if (realId) return { type, realId };
            }
            return null;
        } else {
            if (modelKey.includes('/')) {
                const [specifiedType, actualModel] = modelKey.split('/', 2);
                if (specifiedType === this.type) {
                    const realId = registry.resolveModelId(this.type, actualModel);
                    return realId ? { type: this.type, realId } : null;
                }
                return null;
            }
            const realId = registry.resolveModelId(this.type, modelKey);
            return realId ? { type: this.type, realId } : null;
        }
    }

    /**
     * 生成图片
     */
    async generateImage(ctx, prompt, paths, modelId, meta) {
        const failoverConfig = this.globalConfig.backend?.pool?.failover || {};
        const failoverEnabled = failoverConfig.enabled !== false;

        if (this.type === 'merge' && failoverEnabled) {
            return this._generateImageWithFailover(ctx, prompt, paths, modelId, meta, failoverConfig);
        }

        const resolved = this.resolveModelId(modelId);
        if (!resolved) {
            return { error: `Worker [${this.name}] 不支持模型: ${modelId}` };
        }

        const { type, realId } = resolved;
        return this._executeAdapter(ctx, type, realId, prompt, paths, meta);
    }

    /**
     * Merge 模式下的故障转移生成
     * @private
     */
    async _generateImageWithFailover(ctx, prompt, paths, modelId, meta, failoverConfig = {}) {
        const maxRetries = failoverConfig.maxRetries || 2;
        const candidateTypes = this._getCandidateTypes(modelId);

        if (candidateTypes.length === 0) {
            return { error: `Worker [${this.name}] 不支持模型: ${modelId}` };
        }

        const maxAttempts = maxRetries === 0 ? candidateTypes.length : Math.min(maxRetries + 1, candidateTypes.length);
        let lastError = null;

        for (let i = 0; i < maxAttempts; i++) {
            const { type, realId } = candidateTypes[i];
            const result = await this._executeAdapter(ctx, type, realId, prompt, paths, meta);

            if (!result.error) {
                return result;
            }

            lastError = result.error;
            if (i < maxAttempts - 1) {
                logger.warn('工作池', `[${this.name}] ${type} 失败，尝试下一个适配器...`, { error: lastError, ...meta });
            }
        }

        return { error: `所有支持该模型的适配器都无法使用: ${lastError}` };
    }

    /**
     * 获取支持指定模型的候选适配器类型列表
     * @private
     */
    _getCandidateTypes(modelKey) {
        const candidates = [];

        if (modelKey.includes('/')) {
            const [specifiedType, actualModel] = modelKey.split('/', 2);
            if (this.mergeTypes.includes(specifiedType)) {
                const realId = registry.resolveModelId(specifiedType, actualModel);
                if (realId) {
                    candidates.push({ type: specifiedType, realId });
                }
            }
            return candidates;
        }

        for (const type of this.mergeTypes) {
            const realId = registry.resolveModelId(type, modelKey);
            if (realId) {
                candidates.push({ type, realId });
            }
        }

        return candidates;
    }

    /**
     * 执行单个适配器
     * @private
     */
    async _executeAdapter(ctx, type, realId, prompt, paths, meta) {
        const adapter = registry.getAdapter(type);
        if (!adapter) {
            return { error: `适配器不存在: ${type}` };
        }

        logger.info('工作池', `[${this.name}] 执行任务 -> ${type}/${realId}`, meta);

        const subContext = {
            ...ctx,
            page: this.page,
            config: this.globalConfig,
            proxyConfig: this.proxyConfig,
            userDataDir: this.userDataDir
        };

        this.busyCount++;
        try {
            return await adapter.generateImage(subContext, prompt, paths, realId, meta);
        } finally {
            this.busyCount--;
        }
    }

    /**
     * 获取支持的模型列表
     */
    getModels() {
        if (this.type === 'merge') {
            const allModels = [];
            const seenIds = new Set();

            for (const type of this.mergeTypes) {
                const result = registry.getModelsForAdapter(type);
                if (result?.data) {
                    for (const m of result.data) {
                        if (!seenIds.has(m.id)) {
                            seenIds.add(m.id);
                            allModels.push({ ...m, owned_by: 'internal_server' });
                        }
                    }
                }
            }

            for (const type of this.mergeTypes) {
                const result = registry.getModelsForAdapter(type);
                if (result?.data) {
                    for (const m of result.data) {
                        allModels.push({
                            ...m,
                            id: `${type}/${m.id}`,
                            owned_by: type
                        });
                    }
                }
            }

            return allModels;
        } else {
            const result = registry.getModelsForAdapter(this.type);
            const models = result?.data || [];
            const allModels = [];

            for (const m of models) {
                allModels.push({ ...m, owned_by: 'internal_server' });
            }

            for (const m of models) {
                allModels.push({
                    ...m,
                    id: `${this.type}/${m.id}`,
                    owned_by: this.type
                });
            }

            return allModels;
        }
    }

    /**
     * 获取图片策略（宽松策略：只要有一个适配器支持 optional 就返回 optional）
     */
    getImagePolicy(modelKey) {
        const policies = new Set();

        if (this.type === 'merge') {
            if (modelKey.includes('/')) {
                const [specifiedType, actualModel] = modelKey.split('/', 2);
                if (this.mergeTypes.includes(specifiedType)) {
                    return registry.getImagePolicy(specifiedType, actualModel);
                }
            }
            // 收集所有支持该模型的适配器的 imagePolicy
            for (const type of this.mergeTypes) {
                const realId = registry.resolveModelId(type, modelKey);
                if (realId) {
                    policies.add(registry.getImagePolicy(type, modelKey));
                }
            }
        } else {
            return registry.getImagePolicy(this.type, modelKey);
        }

        // 宽松策略：只要有一个 optional 就返回 optional
        if (policies.has('optional')) return 'optional';
        if (policies.has('required')) return 'required';
        if (policies.has('forbidden')) return 'forbidden';
        return 'optional';
    }

    /**
     * 获取模型类型
     */
    getModelType(modelKey) {
        if (this.type === 'merge') {
            if (modelKey.includes('/')) {
                const [specifiedType, actualModel] = modelKey.split('/', 2);
                if (this.mergeTypes.includes(specifiedType)) {
                    return registry.getModelType(specifiedType, actualModel);
                }
            }
            for (const type of this.mergeTypes) {
                const realId = registry.resolveModelId(type, modelKey);
                if (realId) return registry.getModelType(type, modelKey);
            }
            return 'image';
        } else {
            return registry.getModelType(this.type, modelKey);
        }
    }

    /**
     * 导航到监控页面（空闲时）
     */
    async navigateToMonitor() {
        if (this.type !== 'merge' || !this.mergeMonitor) return;
        if (!this.page || this.page.isClosed()) return;

        const targetUrl = registry.getTargetUrl(this.mergeMonitor, this.globalConfig, this.workerConfig);
        if (!targetUrl) return;

        const currentUrl = this.page.url();
        try {
            if (currentUrl.includes(new URL(targetUrl).hostname)) return;
        } catch (e) { return; }

        logger.info('工作池', `[${this.name}] 空闲，跳转监控: ${this.mergeMonitor}`);
        try {
            await this.page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        } catch (e) {
            logger.warn('工作池', `[${this.name}] 监控跳转失败: ${e.message}`);
        }
    }

    /**
     * 获取 Cookies
     */
    async getCookies(domain) {
        if (!this.page) throw new Error(`Worker [${this.name}] 未初始化`);
        const context = this.page.context();
        if (domain) {
            return await context.cookies(domain.startsWith('http') ? domain : `https://${domain}`);
        }
        return await context.cookies();
    }
}
