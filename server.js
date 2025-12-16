/**
 * @fileoverview LMArena Image Automator 服务器入口
 * @description HTTP API 服务器，提供 OpenAI 兼容的图像生成接口
 *
 * 支持的端点：
 * - GET  /v1/models          - 获取可用模型列表
 * - GET  /v1/cookies         - 获取当前浏览器 Cookies
 * - POST /v1/chat/completions - 生成图像（OpenAI 兼容格式）
 *
 * 命令行参数：
 * - -xvfb  启用 Xvfb 虚拟显示器（仅 Linux）
 * - -vnc   启用 VNC 服务器（需配合 -xvfb 使用）
 * - -login 启动时打开登录页面
 */

import http from 'http';

// ==================== 启动前自检 ====================
import { runPreflight } from './src/utils/preflight.js';
// Xvfb 子进程跳过自检（父进程已完成）
if (!process.env.XVFB_RUNNING) {
    runPreflight();
}
// ==================== 加载其他依赖 ====================
const { getBackend } = await import('./src/backend/index.js');
const { logger } = await import('./src/utils/logger.js');
const { handleDisplayParams, createQueueManager, createRouter } = await import('./src/server/index.js');

// ==================== 命令行参数处理 ====================

// 处理 Xvfb/VNC 参数（仅 Linux）
const displayResult = await handleDisplayParams();
if (displayResult === 'XVFB_REDIRECT') {
    // 已重定向到 Xvfb，阻止继续执行
    process.on('exit', () => { });
    await new Promise(() => { });
}

// ==================== 初始化配置 ====================

/**
 * 从统一后端获取配置和函数
 */
let backend;
try {
    backend = getBackend();
} catch (err) {
    logger.error('服务器', '配置加载失败', { error: err.message });
    logger.error('服务器', '请先初始化配置：复制 config.example.yaml 为 config.yaml');
    process.exit(1);
}

const {
    config,
    name: backendName,
    initBrowser,
    generateImage,
    TEMP_DIR,
    resolveModelId,
    getModels,
    getImagePolicy,
    getModelType
} = backend;

/** @type {number} 服务器端口 */
const PORT = config.server?.port || 3000;

/** @type {string} 认证令牌 */
const AUTH_TOKEN = config.server?.auth;

/** @type {string} 心跳模式 */
const KEEPALIVE_MODE = config.server?.keepalive?.mode || 'comment';

/** @type {number} 最大并发数 */
const MAX_CONCURRENT = config.queue?.maxConcurrent || 1;

/** @type {number} 队列缓冲区（0 表示不限制非流式） */
const QUEUE_BUFFER = config.queue?.queueBuffer ?? 2;

/** @type {number} 图片数量限制 */
const IMAGE_LIMIT = config.queue?.imageLimit || 5;

// ==================== 创建服务组件 ====================

/**
 * 队列管理器：负责任务队列、并发控制和心跳机制
 */
const queueManager = createQueueManager(
    {
        maxConcurrent: MAX_CONCURRENT,
        queueBuffer: QUEUE_BUFFER,
        keepaliveMode: KEEPALIVE_MODE
    },
    {
        initBrowser,
        generateImage,
        config,
        navigateToMonitor: backend.navigateToMonitor
            ? () => backend.navigateToMonitor()
            : null,
        getCookies: backend.getCookies
            ? (workerName, domain) => backend.getCookies(workerName, domain)
            : null
    }
);
const handleRequest = createRouter({
    authToken: AUTH_TOKEN,
    backendName,
    getModels,
    resolveModelId,
    getImagePolicy,
    getModelType,
    tempDir: TEMP_DIR,
    imageLimit: IMAGE_LIMIT,
    queueManager
});

// ==================== 启动服务器 ====================

/**
 * 检测是否为登录模式
 */
const isLoginMode = process.argv.some(arg => arg.startsWith('-login'));

/**
 * 启动 HTTP 服务器
 * @returns {Promise<void>}
 */
async function startServer() {
    // 预先启动 Pool
    try {
        await queueManager.initializePool();
    } catch (err) {
        logger.error('服务器', 'Pool 初始化失败', { error: err.message });
        process.exit(1);
    }

    // 登录模式：不启动 HTTP 服务器，只等待用户登录
    if (isLoginMode) {
        logger.info('服务器', '登录模式已就绪，请在浏览器中完成登录操作');
        logger.info('服务器', '完成后可直接关闭浏览器窗口或按 Ctrl+C 退出');
        return;
    }

    // 创建并启动 HTTP 服务器
    const server = http.createServer(handleRequest);

    server.listen(PORT, () => {
        logger.info('服务器', `HTTP 服务器已启动，端口: ${PORT}`);
        logger.info('服务器', `流式心跳模式: ${KEEPALIVE_MODE}`);
        logger.info('服务器', `最大并发: ${MAX_CONCURRENT}，队列缓冲: ${QUEUE_BUFFER}，最大图片数量: ${IMAGE_LIMIT}`);
    });
}

// 启动服务器
startServer();
