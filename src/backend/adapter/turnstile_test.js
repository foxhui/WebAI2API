/**
 * @fileoverview Cloudflare Turnstile 测试适配器
 * 使用 shadowRootUnl 访问 closed shadow-root 内的元素
 * 
 * HTML 结构:
 * #example-container5 > div > closed shadow-root > iframe
 * iframe body > closed shadow-root > ... > input[type="checkbox"]
 */

import {
    sleep,
    safeClick
} from '../engine/utils.js';
import {
    gotoWithCheck,
    normalizePageError,
    moveMouseAway,
} from '../utils/index.js';
import { logger } from '../../utils/logger.js';

// --- 配置常量 ---
//const TARGET_URL = 'https://nopecha.com/captcha/turnstile';
const TARGET_URL = 'https://nowsecure.nl/';


/**
 * 递归查找具有 shadowRootUnl 的子元素
 */
async function findElementWithShadowRoot(hostHandle) {
    return await hostHandle.evaluateHandle(el => {
        for (const child of el.querySelectorAll('*')) {
            if (child.shadowRootUnl) {
                return child;
            }
        }
        return null;
    });
}

/**
 * 执行 Turnstile 验证任务
 */
async function generate(context, prompt, imgPaths, modelId, meta = {}) {
    const { page } = context;

    try {
        logger.info('适配器', '开启 Turnstile 测试...', meta);
        await gotoWithCheck(page, TARGET_URL);

        // 等待页面加载
        await sleep(3000, 4000);

        // 1. 获取宿主元素
        logger.info('适配器', '正在查找宿主元素...', meta);
        //const hostLocator = page.locator('#example-container5');
        const hostLocator = page.locator('.cf-turnstile').first();

        await hostLocator.waitFor({ state: 'visible', timeout: 10000 });
        const hostHandle = await hostLocator.elementHandle();

        if (!hostHandle) {
            return { error: '无法获取宿主元素句柄' };
        }

        // 2. 查找有 shadowRootUnl 的子元素
        logger.info('适配器', '正在查找有 shadowRootUnl 的子元素...', meta);
        const childWithShadowHandle = await findElementWithShadowRoot(hostHandle);
        const childElement = childWithShadowHandle.asElement();

        if (!childElement) {
            return { error: '未找到有 shadowRootUnl 的子元素' };
        }

        logger.info('适配器', '找到有 shadowRootUnl 的子元素', meta);

        // 3. 获取第一层 shadow-root 并找到 iframe
        const shadowRootHandle = await childElement.evaluateHandle(el => el.shadowRootUnl);
        const iframeHandle = await shadowRootHandle.evaluateHandle(root => root?.querySelector('iframe'));
        const iframeElement = iframeHandle.asElement();

        if (!iframeElement) {
            return { error: '第一层 shadow-root 内未找到 iframe' };
        }

        logger.info('适配器', '找到 iframe，正在进入 iframe 内部...', meta);

        // 4. 获取 iframe 的 contentDocument (使用 contentFrame)
        const frame = await iframeElement.contentFrame();
        if (!frame) {
            logger.warn('适配器', '无法获取 iframe 的 contentFrame，尝试坐标点击...', meta);
            // 降级方案：坐标点击
            const box = await iframeElement.boundingBox();
            if (box) {
                const checkboxX = box.x + 28;
                const checkboxY = box.y + box.height / 2;
                await page.mouse.move(checkboxX, checkboxY, { steps: 10 });
                await sleep(300, 500);
                await page.mouse.click(checkboxX, checkboxY);
                logger.info('适配器', '已点击 checkbox（坐标模式）', meta);
                await sleep(5000, 8000);
                return { text: 'Turnstile 验证已点击（坐标模式）' };
            }
            return { error: '无法获取 iframe 边界框' };
        }

        // 5. 在 iframe 内查找 body 或有 shadowRootUnl 的元素
        logger.info('适配器', '正在查找 iframe 内的 shadow-root...', meta);

        // 等待 iframe 内容加载
        await sleep(1000, 2000);

        // 尝试获取 iframe 内 body 的 shadowRootUnl
        const bodyWithShadowHandle = await frame.evaluateHandle(() => {
            // 先检查 body 本身
            if (document.body && document.body.shadowRootUnl) {
                return document.body;
            }
            // 遍历所有元素查找有 shadowRootUnl 的
            for (const el of document.querySelectorAll('*')) {
                if (el.shadowRootUnl) {
                    return el;
                }
            }
            return null;
        });

        const bodyElement = bodyWithShadowHandle.asElement();
        if (!bodyElement) {
            logger.warn('适配器', 'iframe 内未找到有 shadowRootUnl 的元素，尝试坐标点击...', meta);
            const box = await iframeElement.boundingBox();
            if (box) {
                const checkboxX = box.x + 28;
                const checkboxY = box.y + box.height / 2;
                await page.mouse.move(checkboxX, checkboxY, { steps: 10 });
                await sleep(300, 500);
                await page.mouse.click(checkboxX, checkboxY);
                logger.info('适配器', '已点击 checkbox（坐标模式）', meta);
                await sleep(5000, 8000);
                return { text: 'Turnstile 验证已点击（坐标模式）' };
            }
            return { error: 'iframe 内未找到有 shadowRootUnl 的元素' };
        }

        logger.info('适配器', '找到 iframe 内的 shadowRootUnl 宿主', meta);

        // 6. 获取 iframe 内部的 shadow-root 并查找 checkbox
        const innerShadowRootHandle = await bodyElement.evaluateHandle(el => el.shadowRootUnl);
        const checkboxHandle = await innerShadowRootHandle.evaluateHandle(root => {
            if (!root) return null;
            // 查找 input[type="checkbox"]
            const checkbox = root.querySelector('input[type="checkbox"]');
            if (checkbox) return checkbox;
            // 备用：查找任何 input
            return root.querySelector('input');
        });

        const checkboxElement = checkboxHandle.asElement();
        if (!checkboxElement) {
            logger.warn('适配器', 'iframe shadow-root 内未找到 checkbox，尝试坐标点击...', meta);
            const box = await iframeElement.boundingBox();
            if (box) {
                const checkboxX = box.x + 28;
                const checkboxY = box.y + box.height / 2;
                await page.mouse.move(checkboxX, checkboxY, { steps: 10 });
                await sleep(300, 500);
                await page.mouse.click(checkboxX, checkboxY);
                logger.info('适配器', '已点击 checkbox（坐标模式）', meta);
                await sleep(5000, 8000);
                return { text: 'Turnstile 验证已点击（坐标模式）' };
            }
            return { error: 'iframe shadow-root 内未找到 checkbox' };
        }

        logger.info('适配器', '找到 checkbox，正在点击...', meta);

        // 7. 点击 checkbox
        await safeClick(page, checkboxElement, { bias: 'random' });
        logger.info('适配器', '已点击 checkbox（直接模式）', meta);
        await sleep(5000, 8000);

        return { text: 'Turnstile 验证已点击（直接模式）' };

    } catch (err) {
        const pageError = normalizePageError(err, meta);
        if (pageError) return pageError;

        logger.error('适配器', '任务失败', { ...meta, error: err.message });
        return { error: `任务失败: ${err.message}` };
    } finally {
        await moveMouseAway(page);
    }
}

/**
 * 适配器 manifest
 */
export const manifest = {
    id: 'turnstile_test',
    displayName: 'Cloudflare Turnstile Test',

    getTargetUrl(config, workerConfig) {
        return TARGET_URL;
    },

    models: [
        { id: 'cloudflare-turnstile', imagePolicy: 'forbidden', type: 'text' }
    ],

    navigationHandlers: [],
    generate
};
