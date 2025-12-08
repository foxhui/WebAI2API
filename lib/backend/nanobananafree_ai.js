import fs from 'fs';
import path from 'path';
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

// --- 配置常量 ---
const USER_DATA_DIR = path.join(process.cwd(), 'data', 'camoufoxUserData');
const TARGET_URL = 'https://nanobananafree.ai/';
const TEMP_DIR = path.join(process.cwd(), 'data', 'temp');

// 确保临时目录存在
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

/**
 * 初始化浏览器
 * @param {object} config - 配置对象
 * @returns {Promise<{browser: object, page: object, client: object}>}
 */
async function initBrowser(config) {
    // NanoBananaFree AI 特定的输入框验证逻辑
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
        productName: 'NanoBananaFree AI',
        waitInputValidator
    });
}

/**
 * 执行生图任务
 * @param {object} context - 浏览器上下文 { page, client }
 * @param {string} prompt - 提示词
 * @param {string[]} imgPaths - 图片路径数组 (仅取第一张)
 * @param {string} [modelId] - 指定的模型 ID (可选，目前未使用)
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

        // 1. 上传图片 (仅取第一张，多余的丢弃)
        if (imgPaths && imgPaths.length > 0) {
            const singleImage = [imgPaths[0]]; // 只取第一张
            if (imgPaths.length > 1) {
                logger.warn('适配器', `此后端仅支持1张图片，已丢弃 ${imgPaths.length - 1} 张`, meta);
            }
            await pasteImages(page, textareaSelector, singleImage);
            // 确保焦点在输入框
            await safeClick(page, textareaSelector, { bias: 'input' });
        }

        // 2. 输入提示词
        logger.info('适配器', '正在输入提示词...', meta);
        await humanType(page, textareaSelector, prompt);
        await sleep(800, 1500);

        // 3. 创建页面关闭监听器
        const pageWatcher = createPageCloseWatcher(page);

        try {
            // 检查页面状态
            if (!isPageValid(page)) {
                throw new Error('PAGE_INVALID');
            }

            // 4. 点击发送按钮 (匹配 class 包含 _sendButton_ 的 div)
            logger.debug('适配器', '点击发送...', meta);

            // 使用更通用的选择器匹配发送按钮
            const sendBtnSelector = 'div[class*="_sendButton_"]';
            await page.waitForSelector(sendBtnSelector, { timeout: 10000 });
            await safeClick(page, sendBtnSelector, { bias: 'button' });

            logger.info('适配器', '等待生成结果...', meta);

            // 5. 等待响应 (使用 Promise.race)
            const responsePromise = page.waitForResponse(response =>
                response.url().includes('v1/generateContent') &&
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
            if (response.status() !== 200) {
                // 非200状态，尝试读取错误信息
                try {
                    const body = await response.json();
                    const errMessage = body?.errMessage || body?.error?.message || `HTTP ${response.status()}`;
                    logger.warn('适配器', `请求返回错误: ${errMessage}`, meta);
                    return { error: errMessage };
                } catch (e) {
                    logger.warn('适配器', `返回异常状态码: ${response.status()}`, meta);
                    return { error: `Server error: HTTP ${response.status()}` };
                }
            }

            // 解析成功响应
            const body = await response.json();

            // 尝试从响应中提取 base64 图片
            // 路径: data.candidates[0].content.parts[0].inlineData.data
            const inlineData = body?.data?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

            if (inlineData) {
                logger.info('适配器', '已获取生图结果', meta);
                // 返回带有 data URI 前缀的 base64 图片
                return { image: `data:image/png;base64,${inlineData}` };
            } else {
                // 没有找到图片数据，可能是文本回复或其他格式
                logger.info('适配器', 'AI 返回非图片响应', { ...meta, preview: JSON.stringify(body).substring(0, 150) });
                return { text: JSON.stringify(body) };
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
