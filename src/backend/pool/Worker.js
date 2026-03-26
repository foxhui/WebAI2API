/**
 * @fileoverview Worker 类
 * @description 封装单个浏览器实例，提供模型匹配和任务执行能力
 */

import fs from 'fs';
import { logger } from '../../utils/logger.js';
import { initBrowserBase, createCursor } from '../engine/launcher.js';
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

        // 浏览器所有权（用于共享浏览器场景的协调重启）
        this._isBrowserOwner = false;  // 是否是浏览器的所有者（负责重启）
        this._browserOwner = null;     // 如果是共享者，指向所有者 Worker
        this._sharedWorkers = [];      // 如果是所有者，保存共享该浏览器的 Worker 列表
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

        // 登录模式下不注册导航处理器，避免自动登录干预用户操作
        const isLoginMode = process.argv.some(arg => arg.startsWith('-login'));
        let navigationHandler = null;

        if (!isLoginMode) {
            // 收集导航处理器
            const handlers = [];
            const typesToHandle = this.type === 'merge' ? this.mergeTypes : [this.type];
            for (const type of typesToHandle) {
                const typeHandlers = registry.getNavigationHandlers(type);
                handlers.push(...typeHandlers);
            }

            navigationHandler = handlers.length > 0
                ? async (page) => {
                    for (const handler of handlers) {
                        try {
                            await handler(page);
                        } catch (e) {
                            logger.debug('工作池', `导航处理器执行失败: ${e.message}`);
                        }
                    }
                }
                : null;
        }

        logger.info('工作池', `[${this.name}] 正在初始化浏览器...`);
        if (this.proxyConfig) {
            logger.info('工作池', `[${this.name}] 使用代理: ${this.proxyConfig.type}://${this.proxyConfig.host}:${this.proxyConfig.port}`);
        } else {
            logger.info('工作池', `[${this.name}] 直连模式（无代理）`);
        }

        if (sharedBrowser) {
            await this._initWithSharedBrowser(sharedBrowser, targetUrl, navigationHandler);
            this._isBrowserOwner = false;
        } else {
            await this._initNewBrowser(targetUrl, navigationHandler);
            this._isBrowserOwner = true;
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
        this.page._browserMutex = this._browserMutex;
        const humanizeCursorMode = this.globalConfig?.browser?.humanizeCursor;
        this.page._humanizeCursorMode = humanizeCursorMode;
        // true 表示使用项目维护的 ghost-cursor
        if (humanizeCursorMode === true) {
            this.page.cursor = createCursor(this.page);
        }

        // 保存参数用于重新初始化
        this._targetUrl = targetUrl;
        this._navigationHandler = navigationHandler;

        await this._navigateToTarget(targetUrl);

        if (navigationHandler) {
            this.page.on('framenavigated', async () => {
                try { await navigationHandler(this.page); } catch (e) { /* ignore */ }
            });
        }

        // 监听标签页关闭事件，自动重新创建（仅针对共享者）
        this._registerPageCloseHandler();

        logger.info('工作池', `[${this.name}] 初始化完成`);
    }

    /**
     * 注册标签页关闭事件处理器
     * @private
     */
    _registerPageCloseHandler() {
        if (!this.page) return;

        this.page.on('close', async () => {
            // 如果浏览器还在运行，说明只是标签页被关闭
            if (this.browser && !this.browser.isClosed?.()) {
                logger.warn('工作池', `[${this.name}] 标签页已关闭，正在重新创建...`);
                this.initialized = false;
                this.page = null;
                try {
                    await this._recreatePage();
                } catch (e) {
                    logger.error('工作池', `[${this.name}] 重新创建标签页失败: ${e.message}`);
                }
            }
        });
    }

    /**
     * 重新创建标签页（标签页关闭恢复）
     * @private
     */
    async _recreatePage() {
        this.page = await this.browser.newPage();
        this.page.authState = { isHandlingAuth: false };
        const humanizeCursorMode = this.globalConfig?.browser?.humanizeCursor;
        this.page._humanizeCursorMode = humanizeCursorMode;
        if (humanizeCursorMode === true) {
            this.page.cursor = createCursor(this.page);
        }
        await this._navigateToTarget(this._targetUrl || 'about:blank');

        if (this._navigationHandler) {
            this.page.on('framenavigated', async () => {
                try { await this._navigationHandler(this.page); } catch (e) { /* ignore */ }
            });
        }

        // 重新注册标签页关闭处理器
        this._registerPageCloseHandler();

        this.initialized = true;
        logger.info('工作池', `[${this.name}] 标签页已成功重新创建`);
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
        const humanizeCursorMode = this.globalConfig?.browser?.humanizeCursor;
        this.page._humanizeCursorMode = humanizeCursorMode;
        if (humanizeCursorMode === true) {
            this.page.cursor = createCursor(this.page);
        }

        if (navigationHandler) {
            this.page.on('framenavigated', async () => {
                try { await navigationHandler(this.page); } catch (e) { /* ignore */ }
            });
        }

        // 保存 navigationHandler 用于重新初始化
        this._navigationHandler = navigationHandler;
        this._targetUrl = targetUrl;

        logger.info('工作池', `[${this.name}] 正在连接目标页面...`);
        await this._navigateToTarget(targetUrl);

        // 登录模式：注册浏览器关闭事件（不阻塞，关闭后退出进程）
        const isLoginMode = process.argv.some(arg => arg.startsWith('-login'));
        if (isLoginMode) {
            logger.info('工作池', `[${this.name}] 登录模式已就绪，请在浏览器中完成登录`);
            this.browser.on('close', () => {
                logger.info('工作池', `[${this.name}] 浏览器已关闭，登录模式结束`);
                process.exit(0);
            });
        } else {
            // 非登录模式：注册断开事件，所有者负责重启并同步到共享者
            this.browser.on('close', async () => {
                logger.warn('工作池', `[${this.name}] 浏览器已断开连接，正在自动重新初始化...`);

                // 标记自己和所有共享者为未初始化
                this.initialized = false;
                this.browser = null;
                this.page = null;
                for (const sharedWorker of this._sharedWorkers) {
                    sharedWorker.initialized = false;
                    sharedWorker.browser = null;
                    sharedWorker.page = null;
                }

                try {
                    // 重新初始化浏览器
                    await this._reinit();

                    // 为所有共享者创建新的标签页
                    for (const sharedWorker of this._sharedWorkers) {
                        try {
                            logger.info('工作池', `[${sharedWorker.name}] 正在恢复共享浏览器连接...`);
                            sharedWorker.browser = this.browser;
                            sharedWorker.page = await this.browser.newPage();
                            sharedWorker.page.authState = { isHandlingAuth: false };
                            const sharedCursorMode = this.globalConfig?.browser?.humanizeCursor;
                            sharedWorker.page._humanizeCursorMode = sharedCursorMode;
                            if (sharedCursorMode === true) {
                                sharedWorker.page.cursor = createCursor(sharedWorker.page);
                            }
                            await sharedWorker._navigateToTarget(sharedWorker._targetUrl || 'about:blank');
                            sharedWorker._registerPageCloseHandler();  // 重新注册标签页关闭处理器
                            sharedWorker.initialized = true;
                            logger.info('工作池', `[${sharedWorker.name}] 共享浏览器连接已恢复`);
                        } catch (e) {
                            logger.error('工作池', `[${sharedWorker.name}] 恢复共享浏览器连接失败: ${e.message}`);
                        }
                    }
                } catch (e) {
                    logger.error('工作池', `[${this.name}] 自动重新初始化失败: ${e.message}`);
                }
            });

            // 所有者也需要监听标签页关闭事件
            this._registerPageCloseHandler();
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
            // 检查任一适配器是否支持该模型
            for (const type of this.mergeTypes) {
                if (registry.supportsModel(type, modelId)) return true;
            }
            // 支持 type/model 格式
            if (modelId.includes('/')) {
                const [specifiedType, actualModel] = modelId.split('/', 2);
                if (this.mergeTypes.includes(specifiedType)) {
                    return registry.supportsModel(specifiedType, actualModel);
                }
            }
            return false;
        } else {
            // 支持 type/model 格式
            if (modelId.includes('/')) {
                const [specifiedType, actualModel] = modelId.split('/', 2);
                if (specifiedType === this.type) {
                    return registry.supportsModel(this.type, actualModel);
                }
                return false;
            }
            return registry.supportsModel(this.type, modelId);
        }
    }

    /**
     * 确定模型对应的适配器类型（内部辅助方法）
     * @private
     */
    _getAdapterType(modelKey) {
        if (this.type === 'merge') {
            if (modelKey.includes('/')) {
                const [specifiedType] = modelKey.split('/', 2);
                return this.mergeTypes.includes(specifiedType) ? specifiedType : this.mergeTypes[0];
            }
            // 找到第一个支持该模型的适配器
            for (const type of this.mergeTypes) {
                if (registry.supportsModel(type, modelKey)) return type;
            }
            return this.mergeTypes[0];
        }
        return this.type;
    }

    /**
     * 生成图片
     */
    async generate(ctx, prompt, paths, modelId, meta) {
        const failoverConfig = this.globalConfig.backend?.pool?.failover || {};
        const failoverEnabled = failoverConfig.enabled !== false;

        if (this.type === 'merge' && failoverEnabled) {
            return this._generateWithFailover(ctx, prompt, paths, modelId, meta, failoverConfig);
        }

        // 验证是否支持该模型
        if (!this.supports(modelId)) {
            return { error: `Worker [${this.name}] 不支持模型: ${modelId}` };
        }

        // 确定适配器类型
        const type = this._getAdapterType(modelId);

        // 处理 type/model 格式，提取实际 modelId
        let actualModelId = modelId;
        if (modelId.includes('/')) {
            const parts = modelId.split('/', 2);
            actualModelId = parts[1];
        }

        // 传递原始 modelId 给适配器，由适配器自己解析
        return this._executeAdapter(ctx, type, actualModelId, prompt, paths, meta);
    }

    /**
     * Merge 模式下的故障转移生成
     * @private
     */
    async _generateWithFailover(ctx, prompt, paths, modelId, meta, failoverConfig = {}) {
        const maxRetries = failoverConfig.maxRetries || 2;
        const candidateTypes = this._getCandidateTypes(modelId);

        if (candidateTypes.length === 0) {
            return { error: `Worker [${this.name}] 不支持模型: ${modelId}` };
        }

        const maxAttempts = maxRetries === 0 ? candidateTypes.length : Math.min(maxRetries + 1, candidateTypes.length);
        let lastError = null;

        for (let i = 0; i < maxAttempts; i++) {
            const { type, modelId: actualModelId } = candidateTypes[i];
            const result = await this._executeAdapter(ctx, type, actualModelId, prompt, paths, meta);

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
            if (this.mergeTypes.includes(specifiedType) && registry.supportsModel(specifiedType, actualModel)) {
                candidates.push({ type: specifiedType, modelId: actualModel });
            }
            return candidates;
        }

        // 收集所有支持该模型的适配器
        for (const type of this.mergeTypes) {
            if (registry.supportsModel(type, modelKey)) {
                candidates.push({ type, modelId: modelKey });
            }
        }

        return candidates;
    }

    /**
     * 执行单个适配器
     * @private
     */
    async _executeAdapter(ctx, type, modelId, prompt, paths, meta) {
        // 检查 Worker 是否已初始化（浏览器崩溃后会被标记为 false）
        if (!this.initialized || !this.page || this.page.isClosed()) {
            logger.info('工作池', `[${this.name}] 浏览器已断开，正在自动重新初始化...`, meta);
            try {
                await this._reinit();
            } catch (e) {
                logger.error('工作池', `[${this.name}] 重新初始化失败`, { error: e.message, ...meta });
                return { error: `Worker 重新初始化失败: ${e.message}` };
            }
        }

        const adapter = registry.getAdapter(type);
        if (!adapter) {
            return { error: `适配器不存在: ${type}` };
        }

        logger.info('工作池', `[${this.name}] 执行任务 -> ${type}/${modelId}`, meta);

        const subContext = {
            ...ctx,
            page: this.page,
            config: this.globalConfig,
            proxyConfig: this.proxyConfig,
            userDataDir: this.userDataDir,
            instanceName: this.instanceName  // 用于 UI 锁
        };

        this.busyCount++;
        try {
            // 传递原始 modelId，由适配器自己解析
            return await adapter.generate(subContext, prompt, paths, modelId, meta);
        } finally {
            this.busyCount--;
        }
    }

    /**
     * 重新初始化浏览器（崩溃恢复）
     * @private
     */
    async _reinit() {
        this.initialized = false;
        this.browser = null;
        this.page = null;

        // 使用保存的参数重新初始化
        await this._initNewBrowser(this._targetUrl || 'about:blank', this._navigationHandler || null);
        this.initialized = true;
        logger.info('工作池', `[${this.name}] 浏览器已成功重新初始化`);
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
                if (registry.supportsModel(type, modelKey)) {
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
                if (registry.supportsModel(type, modelKey)) {
                    return registry.getModelType(type, modelKey);
                }
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
