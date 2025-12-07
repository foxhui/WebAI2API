import fs from 'fs';
import path from 'path';
import { initBrowserBase } from '../browser/launcher.js';
import {
    random,
    sleep,
    getRealViewport,
    clamp,
    queryDeep,
    safeClick,
    humanType,
    pasteImages,
    getHumanClickPoint
} from '../browser/utils.js';
import { logger } from '../utils/logger.js';

// --- 配置常量 ---
const USER_DATA_DIR = path.join(process.cwd(), 'data', 'camoufoxUserData');
const TEMP_DIR = path.join(process.cwd(), 'data', 'temp');

// 确保临时目录存在
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

/**
 * 查找 Shadow DOM 中的输入框
 * @param {import('puppeteer').Page} page 
 * @returns {Promise<ElementHandle|null>}
 */
async function findInput(page) {
    return await page.evaluateHandle(() => {
        function queryDeep(root, selector) {
            let found = root.querySelector(selector);
            if (found) return found;
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null, false);
            while (walker.nextNode()) {
                const node = walker.currentNode;
                if (node.shadowRoot) {
                    found = queryDeep(node.shadowRoot, selector);
                    if (found) return found;
                }
            }
            return null;
        }
        const editor = queryDeep(document.body, 'ucs-prosemirror-editor');
        if (!editor) return null;
        return queryDeep(editor.shadowRoot, '.ProseMirror');
    });
}

/**
 * 处理账户选择页面跳转
 * @param {import('puppeteer').Page} page
 * @param {string} targetUrl - 目标 URL，用于判断跳转完成
 * @returns {Promise<boolean>} 是否处理了跳转
 */
async function handleAccountChooser(page) {
    try {
        const currentUrl = page.url();
        if (currentUrl.includes('auth.business.gemini.google/account-chooser')) {
            logger.info('适配器', '检测到账户选择页面，尝试自动确认...');

            // 尝试查找提交按钮 (通常是标准的 button[type="submit"])
            const submitBtn = await page.$('button[type="submit"]');
            if (submitBtn) {
                // 确保按钮在可视区域
                await submitBtn.scrollIntoViewIfNeeded();
                await sleep(300, 500);

                // 使用 safeClick 模拟人类点击行为
                logger.info('适配器', '正在点击提交按钮...');
                const submitHandle = await page.evaluateHandle((btn) => btn, submitBtn);
                await safeClick(page, submitHandle, { bias: 'button' });

                // 点击后等待跳转回目标页面
                logger.info('适配器', '等待跳转回目标页面...');
                try {
                    // 等待 URL 变化：排除所有认证相关页面，只接受目标页面
                    // 不包含 accounts.google.com 和 auth.business.gemini.google
                    // 但包含 business.gemini.google（目标域名）
                    await page.waitForFunction(() => {
                        const href = window.location.href;
                        return !href.includes('accounts.google.com') &&
                            !href.includes('auth.business.gemini.google') &&
                            href.includes('business.gemini.google');
                    }, { timeout: 60000, polling: 1000 });

                    const newUrl = page.url();
                    logger.info('适配器', `已跳转回目标页面`);
                } catch (timeoutErr) {
                    const finalUrl = page.url();
                    logger.warn('适配器', `等待跳转回目标页面超时，尝试继续... 当前URL: ${finalUrl}`);
                }

                // 额外缓冲时间，确保页面完全加载
                await sleep(2000, 3000);
                return true;
            } else {
                logger.warn('适配器', '未找到提交按钮 button[type="submit"]');
            }
        }
    } catch (err) {
        logger.warn('适配器', `处理账户选择页面失败: ${err.message}`);
    }
    return false;
}

/**
 * 初始化浏览器
 * @param {object} config - 配置对象
 * @param {object} [config.browser] - Browser 配置
 * @param {boolean} [config.browser.headless] - 是否开启 Headless 模式
 * @param {string} [config.browser.path] - Browser 可执行文件路径
 * @param {object} [config.browser.proxy] - 代理配置
 * @param {object} [config.backend] - 后端配置
 * @param {object} [config.backend.geminiBiz] - Gemini Biz 配置
 * @param {string} config.backend.geminiBiz.entryUrl - Gemini entry URL (必需)
 * @returns {Promise<{browser: object, page: object, client: object}>}
 */
async function initBrowser(config) {
    // 从配置读取 Gemini Biz entry URL
    const backendCfg = config.backend || {};
    const geminiCfg = backendCfg.geminiBiz || {};
    const targetUrl = geminiCfg.entryUrl;

    if (!targetUrl) {
        throw new Error('GeminiBiz backend missing entry URL: backend.geminiBiz.entryUrl');
    }

    // Gemini Biz 特定的输入框验证
    const waitInputValidator = async (page) => {
        let inputHandle = null;
        let retries = 0;
        const maxRetries = 20;

        logger.info('适配器', '正在寻找输入框 (如果您需要登录，请使用登录模式)...');

        while (retries < maxRetries) {
            try {
                // 检测并处理账户选择页面
                if (await handleAccountChooser(page)) {
                    // 重置重试计数,给更多时间查找输入框
                    retries = 0;
                    continue;
                }

                inputHandle = await findInput(page);
                if (inputHandle && inputHandle.asElement()) {
                    logger.info('适配器', '已找到输入框');
                    break;
                }
            } catch (err) {
                if (err.message.includes('Execution context was destroyed')) {
                    logger.info('适配器', '页面跳转中，继续等待...');
                }
            }
            await sleep(1000, 1500);
            retries++;
            if (retries % 10 === 0) logger.info('适配器', `仍在寻找输入框... (${retries}/${maxRetries})`);
        }

        if (!inputHandle || !inputHandle.asElement()) {
            logger.error('适配器', '等待超时，未找到输入框');
        }

        if (inputHandle && inputHandle.asElement()) {
            const box = await inputHandle.boundingBox();
            if (box) {
                if (page.cursor) {
                    const { x, y } = getHumanClickPoint(box, 'input');
                    await page.cursor.moveTo({ x, y });
                }
                await sleep(500, 1000);
            }
        }
    };

    return await initBrowserBase(config, {
        userDataDir: USER_DATA_DIR,
        targetUrl,
        productName: 'Gemini Enterprise Business',
        waitInputValidator
    });
}

/**
 * 生成图片
 * @param {object} context - 浏览器上下文 { page, client, config }
 * @param {string} prompt - 提示词
 * @param {string[]} imgPaths - 参考图片路径数组
 * @param {string} modelId - 模型 ID (目前未使用,固定为 gemini-3-pro-preview)
 * @returns {Promise<{image?: string, error?: string}>} 生成结果
 */
async function generateImage(context, prompt, imgPaths, modelId, meta = {}) {
    const { page } = context;

    try {
        // 获取配置 (通过闭包或全局)
        const { loadConfig } = await import('../utils/config.js');
        const config = loadConfig();
        const targetUrl = config.backend?.geminiBiz?.entryUrl;

        if (!targetUrl) {
            throw new Error('GeminiBiz backend missing entry URL');
        }

        // 开启新对话
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });

        // 1. 查找输入框
        logger.debug('适配器', '正在寻找输入框...', meta);

        let inputHandle = await findInput(page);
        let retries = 0;
        // 增加重试次数以适应可能的跳转
        while ((!inputHandle || !inputHandle.asElement()) && retries < 30) {
            // 检测并处理账户选择页面
            if (await handleAccountChooser(page)) {
                // 重置重试计数,给更多时间查找输入框
                retries = 0;
            } else {
                await sleep(1000, 1500);
            }

            inputHandle = await findInput(page);
            retries++;
        }

        if (!inputHandle || !inputHandle.asElement()) {
            throw new Error('未找到输入框 (.ProseMirror)');
        }

        // 2. 粘贴图片 (使用自定义验证器)
        if (imgPaths && imgPaths.length > 0) {
            const expectedUploads = imgPaths.length;
            let uploadedCount = 0;
            let metadataCount = 0;

            await pasteImages(page, inputHandle, imgPaths, {
                uploadValidator: (response) => {
                    const url = response.url();
                    if (response.status() === 200) {
                        if (url.includes('global/widgetAddContextFile')) {
                            uploadedCount++;
                            logger.debug('适配器', `图片上传进度 (Add): ${uploadedCount}/${expectedUploads}`, meta);
                            return false; // 未完成,继续等待
                        } else if (url.includes('global/widgetListSessionFileMetadata')) {
                            metadataCount++;
                            logger.info('适配器', `图片上传进度: ${metadataCount}/${expectedUploads}`, meta);

                            // 两个检查都满足才算完成
                            if (uploadedCount >= expectedUploads && metadataCount >= expectedUploads) {
                                return true;
                            }
                        }
                    }
                    return false;
                }
            });
            await sleep(1000, 2000); // 额外缓冲
        }

        // 3. 输入文字
        logger.info('适配器', '正在输入提示词...', meta);
        await humanType(page, inputHandle, prompt);
        await sleep(1000, 2000);

        // 4. 设置拦截器 (使用 Playwright Route)
        logger.debug('适配器', '已启用请求拦截', meta);

        // 清理旧的 route
        await page.unroute('**/*').catch(() => { });

        await page.route(url => url.href.includes('global/widgetStreamAssist'), async (route) => {
            const request = route.request();
            if (request.method() !== 'POST') return route.continue();

            try {
                const postData = request.postDataJSON();
                if (postData) {
                    logger.debug('适配器', '已拦截请求，正在修改...', meta);
                    if (!postData.streamAssistRequest) postData.streamAssistRequest = {};
                    if (!postData.streamAssistRequest.assistGenerationConfig) postData.streamAssistRequest.assistGenerationConfig = {};
                    postData.streamAssistRequest.toolsSpec = { imageGenerationSpec: {} };

                    logger.info('适配器', '已拦截请求，强制使用 Nano Banana Pro', meta);
                    await route.continue({ postData: JSON.stringify(postData) });
                    return;
                }
            } catch (e) {
                logger.error('适配器', '请求拦截处理失败', { ...meta, error: e.message });
            }
            await route.continue();
        });

        // 5. 点击发送
        logger.debug('适配器', '点击发送...', meta);
        const sendBtnHandle = await page.evaluateHandle(() => {
            function queryDeep(root, selector) {
                let found = root.querySelector(selector);
                if (found) return found;
                const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null, false);
                while (walker.nextNode()) {
                    const node = walker.currentNode;
                    if (node.shadowRoot) {
                        found = queryDeep(node.shadowRoot, selector);
                        if (found) return found;
                    }
                }
                return null;
            }
            // 精准匹配发送按钮
            return queryDeep(document.body, 'md-icon-button.send-button.submit, button[aria-label="提交"], button[aria-label="Send"], .send-button');
        });

        if (sendBtnHandle && sendBtnHandle.asElement()) {
            // 确保按钮在可视区域
            await sendBtnHandle.asElement().scrollIntoViewIfNeeded();
            await sleep(300, 500);
            await safeClick(page, sendBtnHandle, { bias: 'button' });
        } else {
            logger.warn('适配器', '未找到发送按钮，尝试回车提交', meta);
            await inputHandle.focus();
            await page.keyboard.press('Enter');
        }

        logger.info('适配器', '等待生成结果中...', meta);

        // 6. 等待结果 (使用 Playwright waitForResponse)
        // 我们需要等待两个响应：
        // 1. widgetStreamAssist (API 响应，检查是否成功)
        // 2. download/v1alpha/projects (图片下载请求)

        const apiResponsePromise = page.waitForResponse(response =>
            response.url().includes('global/widgetStreamAssist') &&
            response.request().method() === 'POST' &&
            (response.status() === 200 || response.status() >= 400),
            { timeout: 120000 }
        ).catch(e => e);

        const imageDownloadPromise = page.waitForResponse(response =>
            response.url().includes('download/v1alpha/projects') &&
            response.request().method() === 'GET' &&
            response.status() === 200,
            { timeout: 120000 }
        ).catch(e => e);

        // 等待 API 响应
        const apiResponse = await apiResponsePromise;

        if (apiResponse instanceof Error) {
            throw apiResponse;
        }

        if (apiResponse.status() !== 200) {
            logger.error('适配器', `请求返回错误状态码: ${apiResponse.status()}`, meta);
            return { error: `API Error: ${apiResponse.status()}` };
        }

        // 等待图片下载响应
        logger.info('适配器', 'API 请求成功，等待图片下载...', meta);
        const imageResponse = await imageDownloadPromise;

        if (imageResponse instanceof Error) {
            throw imageResponse;
        }

        logger.info('适配器', '捕获到图片下载请求', meta);
        // 响应体本身就是 base64 字符串，直接获取文本即可，不需要再次 base64 编码
        const base64 = await imageResponse.text();
        const dataUri = `data:image/png;base64,${base64}`;

        logger.info('适配器', '生图成功', meta);

        // 任务结束,移开鼠标
        if (page.cursor) {
            const currentVp = await getRealViewport(page);
            const relativeX = currentVp.safeWidth * random(0.85, 0.95);
            const relativeY = currentVp.height * random(0.3, 0.7);
            const finalX = clamp(relativeX, 0, currentVp.safeWidth);
            const finalY = clamp(relativeY, 0, currentVp.safeHeight);
            await page.cursor.moveTo({ x: finalX, y: finalY });
        }

        return { image: dataUri };

    } catch (err) {
        logger.error('适配器', '生成任务失败', { ...meta, error: err.message });
        return { error: err.message };
    } finally {
        // 清理拦截器
        await page.unroute('**/*').catch(() => { });
    }
}

export { initBrowser, generateImage, TEMP_DIR };
