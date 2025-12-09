import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { createCursor } from 'ghost-cursor';
import { anonymizeProxy, closeAnonymizedProxy } from 'proxy-chain';
import { spawn } from 'child_process';
import { getRealViewport, clamp, random, sleep } from './utils.js';
import { logger } from '../logger.js';

// 配置 Stealth 插件
const stealth = StealthPlugin();
stealth.enabledEvasions.delete('iframe.contentWindow');
puppeteer.use(stealth);

// 全局状态跟踪
let globalChromeProcess = null;
let globalBrowser = null;
let globalProxyUrl = null;

/**
 * 清理浏览器资源和进程
 * 实现三级退出机制: Puppeteer close -> SIGTERM -> SIGKILL
 * @returns {Promise<void>}
 */
export async function cleanup() {

    // Level 1: 通过 Puppeteer 协议优雅关闭,释放锁并保存 Profile
    if (globalBrowser) {
        try {
            logger.debug('浏览器', '正在断开远程调试连接...');
            await globalBrowser.close();
            globalBrowser = null;
            logger.debug('浏览器', '已断开远程调试连接');
        } catch (e) {
            logger.warn('浏览器', `断开远程调试连接失败 (可能已断开): ${e.message}`);
        }
    }

    // Level 2 & 3: 处理残留进程
    if (globalChromeProcess && !globalChromeProcess.killed) {
        logger.info('浏览器', '正在终止浏览器进程...');
        try {
            // Level 2: 发送 SIGTERM (软杀)
            globalChromeProcess.kill('SIGTERM');

            // 等待进程退出
            const start = Date.now();
            while (Date.now() - start < 2000) {
                try {
                    process.kill(globalChromeProcess.pid, 0);
                    await new Promise(r => setTimeout(r, 200));
                } catch (e) {
                    break;
                }
            }
        } catch (e) { }

        // Level 3: 强制查杀 (SIGKILL)
        try {
            process.kill(globalChromeProcess.pid, 0);
            logger.debug('浏览器', '浏览器进程无响应，执行强制终止 (SIGKILL)...');
            process.kill(-globalChromeProcess.pid, 'SIGKILL');
        } catch (e) { }

        globalChromeProcess = null;
        logger.info('浏览器', '浏览器进程进程已终止');
    }

    // 清理代理
    if (globalProxyUrl) {
        try {
            logger.debug('浏览器', '正在关闭 Socks5 代理桥接');
            await closeAnonymizedProxy(globalProxyUrl, true);
            logger.debug('浏览器', '已关闭 Socks5 代理桥接');
        } catch (e) {
            logger.error('浏览器', '关闭 Socks5 代理桥接失败', { error: e.message });
        }
        globalProxyUrl = null;
    }
}

/**
 * 控制台登录模式实现
 * @param {object} config - 配置对象
 * @param {object} options - 启动选项
 * @param {string} chromePath - Chrome 路径
 * @param {object} chromeConfig - Chrome 配置
 * @returns {Promise<{browser: object, page: object, client: object}>}
 */
async function initConsoleLoginMode(config, options, chromePath, chromeConfig) {
    const { userDataDir, targetUrl, productName } = options;
    
    logger.info('浏览器', '正在启动控制台登录模式...');
    
    // 启动浏览器（无头模式，但启用远程调试）
    const args = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        `--user-data-dir=${userDataDir}`,
        '--no-first-run',
        '--headless=new',
        '--window-size=1280,690',
        '--remote-debugging-port=9222'
    ];

    // GPU 配置
    if (chromeConfig.gpu === false) {
        args.push(
            '--disable-gpu',
            '--use-gl=swiftshader',
            '--disable-accelerated-2d-canvas',
            '--animation-duration-scale=0',
            '--disable-smooth-scrolling'
        );
    }

    const chromeProcess = spawn(chromePath, args, {
        detached: true,
        stdio: 'ignore'
    });
    chromeProcess.unref();
    globalChromeProcess = chromeProcess;

    logger.info('浏览器', '等待浏览器启动...');

    // 等待浏览器调试端口就绪
    let browserWSEndpoint = null;
    for (let i = 0; i < 20; i++) {
        await sleep(1000, 1500);
        try {
            const res = await fetch('http://127.0.0.1:9222/json/version');
            if (res.ok) {
                const data = await res.json();
                if (data && data.webSocketDebuggerUrl) {
                    browserWSEndpoint = data.webSocketDebuggerUrl;
                    break;
                }
            }
        } catch (e) { }
    }

    if (!browserWSEndpoint) {
        throw new Error('无法连接到浏览器调试端口');
    }

    // 连接 Puppeteer
    const browser = await puppeteer.connect({
        browserWSEndpoint: browserWSEndpoint,
        defaultViewport: null
    });

    globalBrowser = browser;
    registerCleanupHandlers();

    const page = await browser.newPage();
    page.cursor = createCursor(page);
    const client = await page.target().createCDPSession();
    await client.send('Network.enable');

    logger.info('浏览器', '正在导航到目标页面...');
    await page.goto(targetUrl, { waitUntil: 'networkidle2' });

    // 开始监控登录流程
    await monitorLoginProcess(page, client, productName);

    return { browser, page, client };
}

/**
 * 监控登录流程并输出交互信息
 * @param {object} page - 页面对象
 * @param {object} client - CDP 客户端
 * @param {string} productName - 产品名称
 */
async function monitorLoginProcess(page, client, productName) {
    logger.info('登录助手', '开始监控登录流程...');
    
    // 监听网络请求，检测登录相关页面
    client.on('Network.responseReceived', async (event) => {
        const url = event.response.url;
        
        // 检测常见的登录相关URL模式
        if (url.includes('accounts.google.com') || url.includes('auth') || url.includes('login')) {
            logger.info('登录助手', `检测到登录页面: ${url}`);
            
            // 等待页面加载完成
            await sleep(2000, 3000);
            
            // 检查页面内容，提供登录指导
            await provideLoginGuidance(page, productName);
        }
    });

    // 监听页面内容变化，检测二维码和验证码
    let lastContent = '';
    const checkInterval = setInterval(async () => {
        try {
            const currentContent = await page.content();
            if (currentContent !== lastContent) {
                lastContent = currentContent;
                await detectLoginElements(page);
            }
        } catch (e) {
            // 忽略错误
        }
    }, 3000);

    // 清理定时器
    page.on('close', () => clearInterval(checkInterval));
}

/**
 * 检测登录相关元素并提供指导
 * @param {object} page - 页面对象
 */
async function detectLoginElements(page) {
    try {
        // 检测二维码
        const qrCodes = await page.$$eval('img, canvas, svg', (elements) => {
            return elements.filter(el => {
                const alt = el.getAttribute('alt') || '';
                const src = el.getAttribute('src') || '';
                const text = el.textContent || '';
                return alt.toLowerCase().includes('qr') || 
                       alt.toLowerCase().includes('code') ||
                       src.toLowerCase().includes('qr') ||
                       text.toLowerCase().includes('qr') ||
                       text.toLowerCase().includes('二维码');
            }).map(el => ({
                alt: el.getAttribute('alt') || '',
                src: el.getAttribute('src') || '',
                tagName: el.tagName
            }));
        });

        if (qrCodes.length > 0) {
            logger.info('登录助手', '检测到二维码，请用手机扫描二维码完成登录');
        }

        // 检测验证码输入框
        const verificationInputs = await page.$$eval('input', (inputs) => {
            return inputs.filter(input => {
                const placeholder = input.getAttribute('placeholder') || '';
                const type = input.getAttribute('type') || '';
                const name = input.getAttribute('name') || '';
                return placeholder.toLowerCase().includes('code') ||
                       placeholder.toLowerCase().includes('verification') ||
                       placeholder.toLowerCase().includes('验证') ||
                       type === 'text' && (name.includes('code') || name.includes('verify'));
            }).map(input => ({
                placeholder: input.getAttribute('placeholder') || '',
                type: input.getAttribute('type') || ''
            }));
        });

        if (verificationInputs.length > 0) {
            logger.info('登录助手', '检测到验证码输入框，请输入收到的验证码');
        }

        // 检测登录成功标志
        const successIndicators = await page.evaluate(() => {
            const bodyText = document.body.textContent.toLowerCase();
            return {
                hasWelcome: bodyText.includes('welcome') || bodyText.includes('欢迎'),
                hasDashboard: bodyText.includes('dashboard') || bodyText.includes('控制台'),
                hasSuccess: bodyText.includes('success') || bodyText.includes('成功')
            };
        });

        if (successIndicators.hasWelcome || successIndicators.hasDashboard || successIndicators.hasSuccess) {
            logger.info('登录助手', '检测到登录成功！');
        }

    } catch (e) {
        // 忽略检测错误
    }
}

/**
 * 提供登录指导
 * @param {object} page - 页面对象
 * @param {string} productName - 产品名称
 */
async function provideLoginGuidance(page, productName) {
    try {
        const pageUrl = page.url();
        
        if (pageUrl.includes('accounts.google.com')) {
            logger.info('登录助手', '检测到 Google 登录页面');
            logger.info('登录助手', '请按照以下步骤操作：');
            logger.info('登录助手', '1. 输入您的 Google 账号');
            logger.info('登录助手', '2. 输入密码');
            logger.info('登录助手', '3. 如有需要，完成两步验证');
        } else if (pageUrl.includes('lmarena.ai')) {
            const pageTitle = await page.title();
            logger.info('登录助手', `检测到 ${productName} 页面: ${pageTitle}`);
        }

        // 检查当前页面是否有登录表单
        const hasLoginForm = await page.evaluate(() => {
            const inputs = document.querySelectorAll('input[type="email"], input[type="text"][name*="email"], input[type="password"]');
            return inputs.length > 0;
        });

        if (hasLoginForm) {
            logger.info('登录助手', '检测到登录表单，请输入您的账号信息');
        }

    } catch (e) {
        // 忽略指导错误
    }
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
        if (globalChromeProcess) globalChromeProcess.kill();
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
 * 初始化浏览器 (统一启动逻辑)
 * @param {object} config - 配置对象
 * @param {object} [config.chrome] - Chrome 配置
 * @param {boolean} [config.chrome.headless] - 是否开启 Headless 模式
 * @param {string} [config.chrome.path] - Chrome 可执行文件路径
 * @param {boolean} [config.chrome.gpu] - 是否启用 GPU
 * @param {object} [config.chrome.proxy] - 代理配置
 * @param {object} options - 启动选项
 * @param {string} options.userDataDir - 用户数据目录路径
 * @param {string} options.targetUrl - 目标 URL
 * @param {string} options.productName - 产品名称(用于日志)
 * @param {boolean} [options.reuseExistingTab=false] - 是否复用已有特定域名的 tab
 * @param {Function} [options.waitInputValidator] - 自定义输入框等待验证函数
 * @returns {Promise<{browser: object, page: object, client: object}>}
 */
export async function initBrowserBase(config, options) {
    const {
        userDataDir,
        targetUrl,
        productName,
        reuseExistingTab = false,
        waitInputValidator = null
    } = options;

    // 检测登录模式
    const isLoginMode = process.argv.includes('-login');
    const isConsoleLoginMode = process.argv.includes('-login-console');
    const ENABLE_AUTOMATION_MODE = !isLoginMode && !isConsoleLoginMode;

    logger.info('浏览器', `开始初始化浏览器 (${productName})`);
    logger.info('浏览器', `自动化模式: ${ENABLE_AUTOMATION_MODE ? '开启' : '关闭'}`);
    
    if (isLoginMode) {
        logger.warn('浏览器', '当前为登录模式，请手动完成登录后关闭登录模式以继续自动化程序！');
    } else if (isConsoleLoginMode) {
        logger.warn('浏览器', '当前为控制台登录模式，请根据提示完成登录验证！');
    }

    const chromeConfig = config?.chrome || {};
    const remoteDebuggingPort = 9222;

    // Chrome 启动参数
    const args = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        `--user-data-dir=${userDataDir}`,
        '--no-first-run'
    ];

    // Headless 模式配置
    if (chromeConfig.headless && !isLoginMode) {
        args.push('--headless=new');
        args.push('--window-size=1280,690');
        args.push('--headless=new');
        args.push('--window-size=1280,690');
        logger.info('浏览器', 'Headless 模式: 启用 (1280x690)');
    } else {
        if (isLoginMode && chromeConfig.headless) {
            logger.warn('浏览器', '登录模式下强制禁用 Headless 模式。');
        }
        // 有头模式:最大化窗口以适配屏幕
        args.push('--start-maximized');
        logger.info('浏览器', 'Headless 模式: 禁用 (最大化窗口)');
    }

    // GPU 配置
    if (chromeConfig.gpu === false) {
        args.push(
            '--disable-gpu',
            '--use-gl=swiftshader',
            '--disable-accelerated-2d-canvas',
            '--animation-duration-scale=0',
            '--disable-smooth-scrolling'
        );
        logger.info('浏览器', 'GPU 加速: 禁用');
    } else {
        logger.info('浏览器', 'GPU 加速: 启用');
    }

    // 代理配置
    let proxyUrlForChrome = null;
    if (chromeConfig.proxy && chromeConfig.proxy.enable) {
        const { type, host, port, user, passwd } = chromeConfig.proxy;

        // 特殊处理 SOCKS5 + Auth (Chrome 原生不支持)
        if (type === 'socks5' && user && passwd) {
            try {
                const upstreamUrl = `socks5://${user}:${passwd}@${host}:${port}`;
                logger.info('浏览器', '检测到需鉴权的 Socks5 代理，正在创建本地代理桥接...');
                // 创建本地中间代理 (无认证 -> 有认证)
                proxyUrlForChrome = await anonymizeProxy(upstreamUrl);
                globalProxyUrl = proxyUrlForChrome; // 记录全局代理
                logger.info('浏览器', `本地代理桥接已建立: ${proxyUrlForChrome} -> ${host}:${port}`);

                args.push(`--proxy-server=${proxyUrlForChrome}`);
                args.push('--disable-quic');
                logger.warn('浏览器', '为增强代理兼容性，已禁用QUIC (HTTP/3)');
                logger.info('浏览器', `代理配置: ${type}://${host}:${port}`);
            } catch (e) {
                logger.error('浏览器', '本地代理桥接创建失败', { error: e.message });
                throw e;
            }
        } else {
            // 常规 HTTP 代理或无认证 SOCKS5
            const proxyUrl = type === 'socks5' ? `socks5://${host}:${port}` : `${host}:${port}`;
            args.push(`--proxy-server=${proxyUrl}`);
            args.push('--disable-quic');
            logger.warn('浏览器', '为增强代理兼容性，已禁用QUIC (HTTP/3)');
            logger.info('浏览器', `代理配置: ${type}://${host}:${port}`);
        }
    }

    let chromePath = chromeConfig.path;
    
    // 如果没有指定 Chrome 路径，使用 Puppeteer 的默认浏览器
    if (!chromePath) {
        try {
            const puppeteer = await import('puppeteer');
            chromePath = puppeteer.executablePath();
            logger.info('浏览器', `使用 Puppeteer 默认浏览器: ${chromePath}`);
        } catch (error) {
            logger.error('浏览器', '无法获取 Puppeteer 默认浏览器路径', { error: error.message });
            throw new Error('Chrome 浏览器路径未配置且无法获取默认路径');
        }
    }

    // --- 模式分支 ---

    if (!ENABLE_AUTOMATION_MODE) {
        if (isConsoleLoginMode) {
            // 控制台登录模式
            return await initConsoleLoginMode(config, options, chromePath, chromeConfig);
        } else {
            // 图形界面登录模式
            logger.info('浏览器', '正在以登录模式启动浏览器...');
            logger.debug('浏览器', `启动路径: ${chromePath}`);

            // 在手动模式下自动打开目标页面
            args.push(targetUrl);

            const chromeProcess = spawn(chromePath, args, {
                detached: false,
                stdio: 'ignore'
            });
            globalChromeProcess = chromeProcess;

            // 注册清理处理器
            registerCleanupHandlers();
            logger.info('浏览器', '浏览器已启动，脚本将持续运行直到浏览器关闭...');

            await new Promise((resolve) => {
                chromeProcess.on('close', async (code) => {
                    logger.warn('浏览器', `浏览器已被关闭 (退出码: ${code})`);
                    await cleanup();
                    resolve();
                });
            });

            logger.info('浏览器', '浏览器已被关闭，脚本退出');
            process.exit(0);
            return null;
        }
    }

    // --- 自动化模式 ---

    let browserWSEndpoint = null;
    try {
        const res = await fetch(`http://127.0.0.1:${remoteDebuggingPort}/json/version`);
        if (res.ok) {
            const data = await res.json();
            if (data && data.webSocketDebuggerUrl) {
                logger.debug('浏览器', '检测到已运行的浏览器实例，正在连接...');
                browserWSEndpoint = data.webSocketDebuggerUrl;
                logger.info('浏览器', '已连接到已运行的浏览器实例，程序将复用实例');
            }
        }
    } catch (e) {
        logger.debug('浏览器', '未检测到运行中的浏览器实例，正在启动新实例...');
    }

    if (!browserWSEndpoint) {
        const automationArgs = [...args, `--remote-debugging-port=${remoteDebuggingPort}`];
        logger.info('浏览器', '正在启动浏览器...');
        logger.debug('浏览器', `启动路径: ${chromePath}`);

        const chromeProcess = spawn(chromePath, automationArgs, {
            detached: true,
            stdio: 'ignore'
        });
        chromeProcess.unref();
        globalChromeProcess = chromeProcess;

        logger.debug('浏览器', '浏览器已启动，等待调试端口就绪...');

        for (let i = 0; i < 20; i++) {
            await sleep(1000, 1500);
            try {
                const res = await fetch(`http://127.0.0.1:${remoteDebuggingPort}/json/version`);
                if (res.ok) {
                    const data = await res.json();
                    if (data && data.webSocketDebuggerUrl) {
                        browserWSEndpoint = data.webSocketDebuggerUrl;
                        logger.debug('浏览器', '浏览器调试接口已就绪');
                        break;
                    }
                }
            } catch (e) { }
        }

        if (!browserWSEndpoint) {
            throw new Error('无法连接到 Chrome 远程调试端口,请检查 Chrome 是否成功启动。');
        }
    }

    // 连接 Puppeteer
    const browser = await puppeteer.connect({
        browserWSEndpoint: browserWSEndpoint,
        defaultViewport: null
    });

    globalBrowser = browser; // 保存实例引用供 cleanup 使用

    logger.info('浏览器', '远程调试已连接');

    // 注册清理处理器
    registerCleanupHandlers();

    browser.on('disconnected', async () => {
        logger.warn('浏览器', '浏览器已断开连接');
        await cleanup();
        process.exit(0);
    });

    // 获取或创建页面
    let page;
    if (reuseExistingTab) {
        // 复用已有标签页
        const pages = await browser.pages();
        const urlDomain = new URL(targetUrl).hostname;
        page = pages.find(p => p.url().includes(urlDomain));

        if (!page) {
            page = await browser.newPage();
            logger.debug('浏览器', '已创建新标签页');
        } else {
            logger.warn('浏览器', '检测到已有目标网站标签页，程序将复用标签页');
        }
    } else {
        // 总是新建标签页
        page = await browser.newPage();
        logger.debug('浏览器', '已创建新标签页');
    }

    // 初始化 ghost-cursor
    page.cursor = createCursor(page);

    // 代理认证 (仅当未使用 proxy-chain 桥接时)
    if (chromeConfig.proxy && chromeConfig.proxy.enable && chromeConfig.proxy.user && !proxyUrlForChrome) {
        await page.authenticate({
            username: chromeConfig.proxy.user,
            password: chromeConfig.proxy.passwd
        });
        logger.info('浏览器', '代理认证: 已激活 (HTTP Basic Auth)');
    }

    // 创建 CDP 会话
    const client = await page.target().createCDPSession();
    await client.send('Network.enable');

    // 注册清理钩子
    if (proxyUrlForChrome) {
        logger.warn('浏览器', '因使用了本地代理桥接，请保持此程序运行，否则浏览器将失去代理连接');
    }

    // --- 行为预热建立人机检测信任 ---
    const urlDomain = new URL(targetUrl).hostname;
    if (!page.url().includes(urlDomain)) {
        logger.info('浏览器', `正在连接 ${productName}...`);
        await page.goto(targetUrl, { waitUntil: 'networkidle2' });
    } else {
        logger.info('浏览器', `页面已在 ${productName}，跳过跳转`);
    }

    logger.info('浏览器', '正在随机浏览页面以建立信任...');

    // 计算屏幕中心点 (动态获取视口大小)
    const vp = await getRealViewport(page);

    // 计算动态中心点
    const centerX = vp.width / 2;
    const centerY = vp.height / 2;

    // 第一次移动:从左上角移动到中心附近
    if (page.cursor) {
        // 使用 clamp 确保随机偏移后仍在屏幕内
        const targetX = clamp(centerX + random(-200, 200), 10, vp.safeWidth);
        const targetY = clamp(centerY + random(-200, 200), 10, vp.safeHeight);

        // 重置 cursor 内部状态 (可选,增加拟人化)
        await page.cursor.moveTo({ x: targetX, y: targetY });
    }
    await sleep(500, 1000);

    // 模拟滚动行为
    try {
        await page.mouse.wheel({ deltaY: random(100, 300) });
        await sleep(800, 1500);
        await page.mouse.wheel({ deltaY: -random(50, 100) });
    } catch (e) { }

    // 如果提供了自定义输入框验证函数,使用它
    if (waitInputValidator && typeof waitInputValidator === 'function') {
        await waitInputValidator(page);
    }

    logger.info('浏览器', '浏览器初始化完成，系统就绪');
    logger.warn('浏览器', '当任务运行时请勿随意调节窗口大小，以免鼠标轨迹错位!');

    return { browser, page, client };
}
