import fs from 'fs';
import path from 'path';
import { gotScraping } from 'got-scraping';
import { initBrowserBase } from '../browser/launcher.js';
import {
    random,
    sleep,
    getRealViewport,
    clamp,
    safeClick,
    humanType,
    pasteImages,
    getHumanClickPoint,
    isPageValid,
    createPageCloseWatcher
} from '../browser/utils.js';
import { logger } from '../utils/logger.js';
import { loadConfig } from '../utils/config.js';
import { getProxyConfig, getHttpProxy } from '../utils/proxy.js';

// --- 配置常量 ---
const USER_DATA_DIR = path.join(process.cwd(), 'data', 'camoufoxUserData');
const TARGET_URL = 'https://lmarena.ai/c/new?mode=direct&chat-modality=image';
const TEMP_DIR = path.join(process.cwd(), 'data', 'temp');

// 确保临时目录存在
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

/**
 * 从响应文本中提取图片 URL
 * @param {string} text - 响应文本内容
 * @returns {string|null} 提取到的图片 URL，如果未找到则返回 null
 */
function extractImage(text) {
    if (!text) return null;
    const lines = text.split('\n');
    for (const line of lines) {
        if (line.startsWith('a2:')) {
            try {
                const data = JSON.parse(line.substring(3));
                if (data?.[0]?.image) return data[0].image;
            } catch (e) { }
        }
    }
    return null;
}

/**
 * 初始化浏览器会话
 * @param {object} config - 全局配置对象
 * @returns {Promise<{browser: object, page: object, client: object}>} 初始化后的浏览器上下文
 */
async function initBrowser(config) {
    // LMArena 特定的输入框验证逻辑
    const waitInputValidator = async (page) => {
        const textareaSelector = 'textarea';
        await page.waitForSelector(textareaSelector, { timeout: 60000 });
        const box = await (await page.$(textareaSelector)).boundingBox();
        if (box) {
            if (page.cursor) {
                const { x, y } = getHumanClickPoint(box, 'input');
                await page.cursor.moveTo({ x, y });
            }
            await sleep(500, 1000);
        }
    };

    return await initBrowserBase(config, {
        userDataDir: USER_DATA_DIR,
        targetUrl: TARGET_URL,
        productName: 'LMArena',
        waitInputValidator
    });
}

/**
 * 执行生图任务
 * @param {object} context - 浏览器上下文 { page, client }
 * @param {string} prompt - 提示词
 * @param {string[]} imgPaths - 图片路径数组
 * @param {string} [modelId] - 指定的模型 ID (可选)
 * @param {object} [meta={}] - 日志元数据
 * @returns {Promise<{image?: string, text?: string, error?: string}>} 生成结果
 */
async function generateImage(context, prompt, imgPaths, modelId, meta = {}) {
    const { page } = context;
    const textareaSelector = 'textarea';

    try {
        logger.info('适配器', '开启新会话', meta);
        await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded' });

        // 等待输入框加载
        await page.waitForSelector(textareaSelector, { timeout: 30000 });
        await sleep(1500, 2500);

        // 1. 上传图片
        if (imgPaths && imgPaths.length > 0) {
            await pasteImages(page, textareaSelector, imgPaths);
            // 确保焦点在输入框
            await safeClick(page, textareaSelector, { bias: 'input' });
        }

        // 2. 输入提示词
        logger.info('适配器', '正在输入提示词...', meta);
        await humanType(page, textareaSelector, prompt);
        await sleep(800, 1500);

        // 3. 配置请求拦截 (用于修改模型 ID)
        await page.unroute('**/*').catch(() => { });

        if (modelId) {
            logger.debug('适配器', `准备拦截请求`, meta);
            await page.route(url => url.href.includes('/nextjs-api/stream'), async (route) => {
                const request = route.request();
                if (request.method() !== 'POST') return route.continue();

                try {
                    const postData = request.postDataJSON();
                    if (postData && postData.modelAId) {
                        logger.info('适配器', `已拦截请求并修改模型: ${postData.modelAId} -> ${modelId}`, meta);
                        postData.modelAId = modelId;
                        await route.continue({ postData: JSON.stringify(postData) });
                        return;
                    }
                } catch (e) {
                    logger.error('适配器', '拦截处理异常', { ...meta, error: e.message });
                }
                await route.continue();
            });
        }

        // 4. 创建页面关闭监听器
        const pageWatcher = createPageCloseWatcher(page);

        try {
            // 检查页面状态
            if (!isPageValid(page)) {
                throw new Error('PAGE_INVALID');
            }

            // 5. 点击发送按钮
            logger.debug('适配器', '点击发送...', meta);
            const btnSelector = 'button[type="submit"]';
            await safeClick(page, btnSelector, { bias: 'button' });

            logger.info('适配器', '等待生成结果...', meta);

            // 6. 等待响应 (使用 Promise.race)
            const responsePromise = page.waitForResponse(response =>
                response.url().includes('/nextjs-api/stream') &&
                response.request().method() === 'POST' &&
                (response.status() === 200 || response.status() >= 400),
                { timeout: 120000 }
            );

            const response = await Promise.race([
                responsePromise,
                pageWatcher.promise
            ]).catch(e => {
                // 错误分类
                if (e.message === 'PAGE_CLOSED') {
                    logger.error('适配器', '页面已关闭（等待响应期间）', meta);
                    throw new Error('页面已关闭，请勿在生图过程中刷新页面');
                }
                if (e.message === 'PAGE_CRASHED') {
                    logger.error('适配器', '页面崩溃（等待响应期间）', meta);
                    throw new Error('页面崩溃，请重试');
                }
                if (e.name === 'TimeoutError') {
                    logger.error('适配器', 'API 请求超时（120秒）', meta);
                    throw new Error('API 请求超时（120秒），请检查网络或稍后重试');
                }
                throw e;
            });

            // 检查状态码
            if (response.status() === 429 || content.includes('Too Many Requests')) {
                logger.warn('适配器', '触发限流/上游繁忙', meta);
                return { error: 'Rate limit exceeded or CAPTCHA triggered (HTTP 429)' };
            }

            if (response.status() !== 200) {
                logger.warn('适配器', `返回异常状态码: ${response.status()}`, meta);
                return { error: `Server error: HTTP ${response.status()}` };
            }

            // 解析成功响应
            const content = await response.text();

            // 检查业务错误
            if (content.includes('recaptcha validation failed')) {
                logger.warn('适配器', '触发人机验证', meta);
                return { error: 'recaptcha validation failed' };
            }

            const img = extractImage(content);
            if (img) {
                logger.info('适配器', '已获取生图结果，正在下载图片...', meta);
                try {
                    // 获取代理配置
                    const config = loadConfig();
                    const proxyConfig = getProxyConfig(config);
                    const proxyUrl = await getHttpProxy(proxyConfig);

                    const options = {
                        url: img,
                        responseType: 'buffer',
                        http2: true,
                        headerGeneratorOptions: {
                            browsers: [{ name: 'firefox', minVersion: 100 }],
                            devices: ['desktop'],
                            locales: ['en-US'],
                            operatingSystems: ['windows'],
                        }
                    };

                    if (proxyUrl) {
                        options.proxyUrl = proxyUrl;
                    }

                    const imgRes = await gotScraping(options);
                    const base64 = imgRes.body.toString('base64');
                    return { image: `data:image/png;base64,${base64}` };
                } catch (e) {
                    return { error: `Image download failed: ${e.message}` };
                }
            } else {
                logger.info('适配器', 'AI 返回文本回复', { ...meta, preview: content.substring(0, 150) });
                return { text: content };
            }

        } finally {
            // 清理页面事件监听器
            pageWatcher.cleanup();
        }

    } catch (err) {
        if (err.name === 'TimeoutError') return { error: 'Timeout: 生成响应超时' };
        logger.error('适配器', '生成任务失败', { ...meta, error: err.message });
        return { error: err.message };
    } finally {
        // 清理拦截器
        if (modelId) await page.unroute('**/*').catch(() => { });

        // 任务结束，将鼠标移至安全区域
        if (page.cursor) {
            try {
                const vp = await getRealViewport(page);
                await page.cursor.moveTo({
                    x: clamp(vp.safeWidth * random(0.85, 0.95), 0, vp.safeWidth),
                    y: clamp(vp.height * random(0.3, 0.7), 0, vp.safeHeight)
                });
            } catch (e) { }
        }
    }
}

export { initBrowser, generateImage, TEMP_DIR };