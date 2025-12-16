/**
 * @fileoverview 浏览器启动与生命周期管理
 * @description 负责启动 Camoufox（Playwright 内核）、注入指纹与代理，并在进程退出时做资源清理。
 *              导航和预热行为由工作池负责，本模块只负责启动浏览器。
 *
 * 约定：
 * - 登录模式会尽量保留 Profile（用户数据目录）
 * - 清理采用三级退出：Playwright close -> SIGTERM -> SIGKILL
 */

import { Camoufox } from 'camoufox-js';
import { FingerprintGenerator } from 'fingerprint-generator';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createCursor } from 'ghost-cursor-playwright-port';
import { getRealViewport, clamp, random, sleep } from './utils.js';
import { logger } from '../utils/logger.js';
import { getBrowserProxy, cleanupProxy } from '../utils/proxy.js';

// 全局状态：用于在登录模式下管理残留进程与复用上下文
let globalBrowserProcess = null;
let globalContext = null; // 替代 globalBrowser

/**
 * 清理浏览器资源和进程
 * 实现三级退出机制: Playwright close -> SIGTERM -> SIGKILL
 * @returns {Promise<void>}
 */
export async function cleanup() {

    // Level 1: 通过 Playwright 协议优雅关闭 Context，保存 Profile
    if (globalContext) {
        try {
            logger.debug('浏览器', '正在断开远程调试连接并保存 Profile...');
            await globalContext.close();
            globalContext = null;
            logger.debug('浏览器', '已关闭浏览器上下文');
        } catch (e) {
            logger.warn('浏览器', `关闭上下文失败: ${e.message}`);
        }
    }

    // Level 2 & 3: 处理残留进程 (主要用于登录模式)
    if (globalBrowserProcess && !globalBrowserProcess.killed) {
        logger.info('浏览器', '正在终止浏览器进程...');
        try {
            // Level 2: 发送 SIGTERM (软杀)
            globalBrowserProcess.kill('SIGTERM');

            // 等待进程退出
            const start = Date.now();
            while (Date.now() - start < 2000) {
                try {
                    process.kill(globalBrowserProcess.pid, 0);
                    await new Promise(r => setTimeout(r, 200));
                } catch (e) {
                    break;
                }
            }
        } catch (e) { }

        // Level 3: 强制查杀 (SIGKILL)
        try {
            process.kill(globalBrowserProcess.pid, 0);
            logger.debug('浏览器', '浏览器进程无响应，执行强制终止 (SIGKILL)...');
            process.kill(-globalBrowserProcess.pid, 'SIGKILL');
        } catch (e) { }

        globalBrowserProcess = null;
        logger.info('浏览器', '浏览器进程已终止');
    }

    // 清理代理
    await cleanupProxy();
}

// 防止重复注册
let signalHandlersRegistered = false;

/**
 * 注册进程退出信号处理
 * @private
 */
function registerCleanupHandlers() {
    if (signalHandlersRegistered) return;

    process.on('exit', () => {
        if (globalBrowserProcess) globalBrowserProcess.kill();
    });

    process.on('SIGINT', async () => {
        await cleanup();
        process.exit();
    });

    process.on('SIGTERM', async () => {
        await cleanup();
        process.exit();
    });

    signalHandlersRegistered = true;
}

/**
 * 获取当前操作系统名称
 * 将 Node.js 的 platform 转换为 Camoufox/FingerprintGenerator 支持的格式
 */
function getCurrentOS() {
    const platform = os.platform();
    if (platform === 'win32') return 'windows';
    if (platform === 'darwin') return 'macos';
    // 其他情况默认为 linux
    return 'linux';
}

/**
 * 获取或生成持久化指纹
 * @param {string} filePath - JSON文件保存路径
 */
function getPersistentFingerprint(filePath) {
    // 确保 data 目录存在
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    // 尝试读取现有指纹
    if (fs.existsSync(filePath)) {
        try {
            const fileContent = fs.readFileSync(filePath, 'utf8');
            const savedData = JSON.parse(fileContent);

            // 简单校验：确保读取的是一个对象
            if (savedData && typeof savedData === 'object') {
                return savedData;
            }
        } catch (e) {
            logger.warn('浏览器', `读取指纹文件失败，将重新生成: ${e.message}`);
        }
    }

    // 生成新指纹
    const currentOS = getCurrentOS();
    logger.info('浏览器', `正在为系统 [${currentOS}] 生成新指纹...`);

    // 为不同系统使用不同的配置策略
    const generatorOptions = {
        browsers: ['firefox'],
        operatingSystems: [currentOS],
        devices: ['desktop'],
        locales: ['en-US'],
        screen: {
            minWidth: 1280, maxWidth: 1366,
            minHeight: 720, maxHeight: 768
        }
    };

    const generator = new FingerprintGenerator(generatorOptions);

    const result = generator.getFingerprint();

    // 关键点：我们只需要 result.fingerprint 部分
    const fingerprintToSave = result.fingerprint;

    // 保存到文件
    fs.writeFileSync(filePath, JSON.stringify(fingerprintToSave, null, 2));
    logger.info('浏览器', `新指纹已保存至: ${filePath}`);

    return fingerprintToSave;
}

/**
 * 启动浏览器实例 (仅负责启动，不负责导航和预热)
 * 
 * 导航到目标页面、注册导航处理器、预热行为由工作池 (pool.js) 负责。
 * 
 * @param {object} config - 全局配置对象
 * @param {object} options - 启动选项
 * @param {string} options.userDataDir - 用户数据目录路径
 * @param {string} [options.userDataMark] - 用户数据目录标识 (用于日志显示)
 * @param {object} [options.proxyConfig] - Worker 级代理配置
 * @returns {Promise<{context: object, page: object}>} 浏览器上下文和初始页面
 */
export async function initBrowserBase(config, options = {}) {
    const {
        userDataDir,
        instanceName = null,
        proxyConfig = null
    } = options;

    // 日志标识 (优先使用实例名称)
    const markLabel = instanceName || '默认';

    // 检测登录模式和 Xvfb 模式
    const isLoginMode = process.argv.some(arg => arg.startsWith('-login'));
    const isXvfbMode = process.env.XVFB_RUNNING === 'true';
    const headlessMode = config?.browser?.headless && !isLoginMode && !isXvfbMode;

    // 如果配置了无头模式但被强制禁用，输出原因
    if (config?.browser?.headless && !headlessMode) {
        const reasons = [];
        if (isLoginMode) reasons.push('登录模式');
        if (isXvfbMode) reasons.push('Xvfb 模式');
        logger.info('浏览器', `[${markLabel}] 无头模式已被禁用 (${reasons.join(' + ')})`);
    }

    logger.info('浏览器', `[${markLabel}] 启动浏览器实例...`);

    const browserConfig = config?.browser || {};

    // 获取指纹对象（指纹文件放在对应的 userDataDir 内）
    const fingerprintPath = path.join(userDataDir, 'fingerprint.json');
    const myFingerprint = getPersistentFingerprint(fingerprintPath);

    // 构造 Camoufox 启动选项
    const currentOS = getCurrentOS();
    const camoufoxLaunchOptions = {
        executable_path: browserConfig.path || undefined,
        headless: headlessMode,
        user_data_dir: userDataDir,
        window: [1366, 768],
        ff_version: 135,
        fingerprint: myFingerprint,
        os: currentOS,
        i_know_what_im_doing: true,
        block_webrtc: true,
        exclude_addons: ['UBO'],
        geoip: true,
        config: {
            forceScopeAccess: true
        }
    };

    // 代理配置
    const proxyObj = await getBrowserProxy(proxyConfig);
    if (proxyObj) {
        camoufoxLaunchOptions.proxy = proxyObj;
    }

    // 启动 Camoufox
    const context = await Camoufox(camoufoxLaunchOptions);
    globalContext = context;

    // 构建状态描述
    const statusParts = [];
    statusParts.push(`无头模式: ${headlessMode ? '是' : '否'}`);
    if (proxyObj) statusParts.push('代理: 已配置');
    logger.info('浏览器', `[${markLabel}] 浏览器已启动 (${statusParts.join(', ')})`);

    // 注册清理处理器
    registerCleanupHandlers();

    // 注册断开连接事件
    context.on('close', async () => {
        logger.warn('浏览器', `[${markLabel}] 浏览器已断开连接`);
        await cleanup();
        process.exit(0);
    });

    // 获取或创建 Page
    let page;
    const existingPages = context.pages();
    if (existingPages.length > 0) {
        page = existingPages[0];
    } else {
        page = await context.newPage();
    }

    // 强制刷新视口大小
    await page.setViewportSize({ width: 1366, height: 768 });

    // 返回 context 和 page（导航、预热、cursor 初始化由工作池负责）
    return {
        context,
        page
    };
}

// 导出工具函数供 pool.js 使用
export { createCursor, getRealViewport, clamp, random, sleep };
