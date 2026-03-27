/**
 * @fileoverview 浏览器测试适配器
 * 提供多种浏览器测试功能，包括 Cloudflare Turnstile 验证、指纹检测等
 * 
 * 模型类型:
 * - cloudflare-turnstile: 点击验证后截屏
 * - 其他 image 类型: 加载页面后截屏
 * - text 类型: 返回页面文本内容
 */

import { sleep } from '../engine/utils.js';
import {
    gotoWithCheck,
    normalizePageError
} from '../utils/index.js';
import { clickTurnstile } from '../utils/CloudflareBypass.js';
import { logger } from '../../utils/logger.js';

/**
 * 执行 Turnstile 验证并截屏
 */
async function handleTurnstile(page, meta) {
    const TARGET_URL = 'https://nopecha.com/captcha/turnstile';
    const HOST_SELECTOR = '#example-container5';

    logger.info('适配器', '开启 Turnstile 测试...', meta);
    await gotoWithCheck(page, TARGET_URL);

    // 等待页面加载
    await sleep(3000, 4000);

    // 使用通用 Cloudflare 验证码点击器
    const result = await clickTurnstile(page, HOST_SELECTOR, {
        timeout: 10000,
        waitAfterClick: 3000,
        meta
    });

    if (!result.success) {
        return { error: result.error };
    }

    // 截屏并返回
    logger.info('适配器', '正在截屏...', meta);
    const screenshot = await page.screenshot({ type: 'png', fullPage: true });
    const base64 = screenshot.toString('base64');

    return { image: `data:image/png;base64,${base64}` };
}

/**
 * 处理普通 image 类型：加载页面后截屏
 */
async function handleImagePage(page, url, meta) {
    logger.info('适配器', `正在加载页面: ${url}`, meta);
    await gotoWithCheck(page, url);

    // 等待页面加载完成
    await sleep(3000, 5000);

    // 截屏并返回
    logger.info('适配器', '正在截屏...', meta);
    const screenshot = await page.screenshot({ type: 'png', fullPage: true });
    const base64 = screenshot.toString('base64');

    return { image: `data:image/png;base64,${base64}` };
}

/**
 * 处理 ping0.cc：检测并处理 Cloudflare 验证后截屏
 */
async function handlePing0(page, url, meta) {
    logger.info('适配器', `正在加载页面: ${url}`, meta);
    await gotoWithCheck(page, url);

    // 等待页面加载
    await sleep(2000, 3000);

    // 检测是否有 Cloudflare 验证码
    const cfElement = await page.$('#captcha-element');
    if (cfElement) {
        logger.info('适配器', '检测到 Cloudflare 验证码，正在处理...', meta);

        const result = await clickTurnstile(page, '#captcha-element', {
            timeout: 10000,
            waitAfterClick: 5000,
            meta
        });

        if (!result.success) {
            logger.warn('适配器', `Cloudflare 验证失败: ${result.error}`, meta);
            // 继续截屏，可能验证页面也有价值
        }

        // 等待页面跳转或刷新
        await sleep(3000, 5000);
    }

    // 截屏并返回
    logger.info('适配器', '正在截屏...', meta);
    const screenshot = await page.screenshot({ type: 'png', fullPage: true });
    const base64 = screenshot.toString('base64');

    return { image: `data:image/png;base64,${base64}` };
}

/**
 * 处理 text 类型：返回页面文本内容
 */
async function handleTextPage(page, url, meta) {
    logger.info('适配器', `正在加载页面: ${url}`, meta);
    await gotoWithCheck(page, url);

    // 等待页面加载完成
    await sleep(1000, 2000);

    // 获取页面文本内容
    const textContent = await page.evaluate(() => document.body.innerText);
    logger.info('适配器', `获取文本内容，长度: ${textContent.length}`, meta);

    return { text: textContent.trim() };
}

/**
 * 行为录制：记录用户在页面上的操作
 * prompt 格式: URL地址 [录制时长秒数]
 * 例如: https://example.com 30
 */
async function handleRecord(page, prompt, meta) {
    const parts = prompt.trim().split(/\s+/);
    const url = parts[0];
    const duration = parseInt(parts[1]) || 30; // 默认录制 30 秒

    if (!url.startsWith('http')) {
        return { error: '请在 prompt 中提供有效的 URL 地址，格式: URL [录制时长秒数]' };
    }

    logger.info('适配器', `行为录制: ${url}, 时长: ${duration}秒`, meta);
    await gotoWithCheck(page, url);

    // 等待页面加载
    await sleep(2000, 3000);

    // 注入录制脚本
    await page.evaluate(() => {
        window.__recordedActions = [];
        window.__recordStartTime = Date.now();

        // 获取单个元素的选择器（不递归）
        function getElementSelector(el, allowTextSelector = false) {
            if (!el || el === document.body || el === document.documentElement) return null;

            // 优先使用 data-testid
            const testid = el.getAttribute?.('data-testid');
            if (testid) return `[data-testid="${testid}"]`;

            // 其次使用 id（排除动态生成的 radix id）
            if (el.id && typeof el.id === 'string' && !el.id.startsWith('radix-')) {
                return `#${el.id}`;
            }

            // 使用 aria-label
            const ariaLabel = el.getAttribute?.('aria-label');
            if (ariaLabel) return `[aria-label="${ariaLabel}"]`;

            // 使用 name 属性
            const name = el.getAttribute?.('name');
            if (name) return `[name="${name}"]`;

            // 使用 placeholder
            const placeholder = el.getAttribute?.('placeholder');
            if (placeholder) return `[placeholder="${placeholder}"]`;

            // 使用 role + 文本（仅限有意义的 role）
            const role = el.getAttribute?.('role');
            if (role && ['button', 'menuitem', 'option', 'textbox', 'tab', 'switch'].includes(role)) {
                const text = el.innerText?.slice(0, 30)?.trim();
                if (text) return `[role="${role}"]:has-text("${text}")`;
                return `[role="${role}"]`;
            }

            // 对于 button 标签，使用 button:has-text() 选择器
            const tag = el.tagName?.toLowerCase();
            if (tag === 'button') {
                const text = el.innerText?.slice(0, 30)?.trim();
                if (text) return `button:has-text("${text}")`;
            }

            // 如果允许使用文本选择器，且有文本内容
            if (allowTextSelector) {
                const text = el.innerText?.slice(0, 30)?.trim();
                if (text && text.length > 1 && !text.includes('\n')) {
                    return `text="${text}"`;
                }
            }

            return null;
        }

        // 获取元素的最佳选择器（会向上查找父元素）
        function getBestSelector(el, maxDepth = 5) {
            if (!el || el === document.body || el === document.documentElement) return null;

            // 先尝试当前元素
            let selector = getElementSelector(el);
            if (selector) return selector;

            // 向上查找父元素（最多 maxDepth 层）
            let current = el.parentElement;
            let depth = 0;
            while (current && current !== document.body && depth < maxDepth) {
                selector = getElementSelector(current);
                if (selector) return selector;
                current = current.parentElement;
                depth++;
            }

            // 再次遍历，这次允许使用文本选择器
            current = el;
            depth = 0;
            while (current && current !== document.body && depth < maxDepth) {
                selector = getElementSelector(current, true);
                if (selector) return selector;
                current = current.parentElement;
                depth++;
            }

            // 最后使用标签 + class（处理 SVG 元素的 className 是对象的情况）
            const tag = el.tagName?.toLowerCase() || 'element';
            let className = el.className;
            if (className && typeof className === 'object' && className.baseVal !== undefined) {
                // SVG 元素的 className 是 SVGAnimatedString
                className = className.baseVal;
            }
            if (className && typeof className === 'string') {
                const firstClass = className.split(' ')[0];
                if (firstClass && !firstClass.startsWith('[object')) {
                    return `${tag}.${firstClass}`;
                }
            }

            return tag;
        }

        // 获取元素的 DOM 路径（调试用）
        function getElementPath(el, maxDepth = 5) {
            const path = [];
            let current = el;
            let depth = 0;
            while (current && current !== document.body && depth < maxDepth) {
                const tag = current.tagName?.toLowerCase() || '?';
                const testid = current.getAttribute?.('data-testid');
                const id = current.id;
                const role = current.getAttribute?.('role');
                let desc = tag;
                if (testid) desc += `[data-testid="${testid}"]`;
                else if (id && !id.startsWith('radix-')) desc += `#${id}`;
                else if (role) desc += `[role="${role}"]`;
                path.push(desc);
                current = current.parentElement;
                depth++;
            }
            return path.join(' < ');
        }

        // 记录点击事件
        document.addEventListener('click', (e) => {
            const selector = getBestSelector(e.target);
            const path = getElementPath(e.target);
            window.__recordedActions.push({
                type: 'click',
                selector: selector || 'unknown',
                text: e.target.innerText?.slice(0, 50)?.trim(),
                path,  // 添加元素路径用于调试
                timestamp: Date.now() - window.__recordStartTime
            });
        }, true);

        // 记录输入事件
        document.addEventListener('input', (e) => {
            const selector = getBestSelector(e.target);
            if (selector) {
                // 更新最后一个相同选择器的输入，避免每个字符都记录
                const lastAction = window.__recordedActions[window.__recordedActions.length - 1];
                if (lastAction && lastAction.type === 'input' && lastAction.selector === selector) {
                    lastAction.value = e.target.value || e.target.innerText;
                    lastAction.timestamp = Date.now() - window.__recordStartTime;
                } else {
                    window.__recordedActions.push({
                        type: 'input',
                        selector,
                        value: e.target.value || e.target.innerText,
                        timestamp: Date.now() - window.__recordStartTime
                    });
                }
            }
        }, true);

        // 记录键盘事件（主要是 Enter、Escape 等特殊键）
        document.addEventListener('keydown', (e) => {
            if (['Enter', 'Escape', 'Tab'].includes(e.key)) {
                const selector = getBestSelector(e.target);
                window.__recordedActions.push({
                    type: 'keypress',
                    key: e.key,
                    selector,
                    timestamp: Date.now() - window.__recordStartTime
                });
            }
        }, true);

        // 记录页面导航
        window.addEventListener('beforeunload', () => {
            window.__recordedActions.push({
                type: 'navigation',
                url: window.location.href,
                timestamp: Date.now() - window.__recordStartTime
            });
        });
    });

    logger.info('适配器', `开始录制，请在浏览器中操作，${duration}秒后自动结束...`, meta);

    // 等待录制时长
    await sleep(duration * 1000, duration * 1000 + 100);

    // 收集录制的操作
    const actions = await page.evaluate(() => window.__recordedActions || []);

    logger.info('适配器', `录制完成，共记录 ${actions.length} 个操作`, meta);

    // 格式化输出
    let output = `# 行为录制结果\nURL: ${url}\n录制时长: ${duration}秒\n操作数量: ${actions.length}\n\n`;

    if (actions.length === 0) {
        output += '未检测到任何操作。\n';
    } else {
        output += '## 操作序列\n\n';
        output += '```javascript\n';
        output += '// Playwright 代码\n';

        let lastTimestamp = 0;
        for (const action of actions) {
            // 添加等待时间
            const waitTime = action.timestamp - lastTimestamp;
            if (waitTime > 1000) {
                output += `await sleep(${Math.round(waitTime / 100) * 100}); // 等待 ${(waitTime / 1000).toFixed(1)}秒\n`;
            }
            lastTimestamp = action.timestamp;

            switch (action.type) {
                case 'click':
                    output += `await page.click('${action.selector}'); // ${action.text || '点击'}\n`;
                    break;
                case 'input':
                    output += `await page.fill('${action.selector}', '${action.value?.replace(/'/g, "\\'")}');\n`;
                    break;
                case 'keypress':
                    output += `await page.keyboard.press('${action.key}');\n`;
                    break;
                case 'navigation':
                    output += `// 页面导航到: ${action.url}\n`;
                    break;
            }
        }
        output += '```\n\n';

        output += '## 原始操作数据\n\n';
        output += '```json\n';
        output += JSON.stringify(actions, null, 2);
        output += '\n```\n';
    }

    return { text: output };
}

/**
 * 元素探测：提取页面上的可交互元素信息
 * prompt 格式: URL 地址
 */
async function handleInspect(page, prompt, meta) {
    const url = prompt.trim();
    if (!url.startsWith('http')) {
        return { error: '请在 prompt 中提供有效的 URL 地址' };
    }

    logger.info('适配器', `元素探测: ${url}`, meta);
    await gotoWithCheck(page, url);

    // 等待页面加载
    await sleep(3000, 5000);

    // 提取页面元素信息
    const elements = await page.evaluate(() => {
        const results = {
            buttons: [],
            inputs: [],
            textareas: [],
            selects: [],
            dataTestIds: [],
            roles: [],
            clickables: []  // 新增：可点击元素
        };

        // 提取按钮 (增加到 100 个)
        document.querySelectorAll('button').forEach((el, i) => {
            if (i >= 100) return;
            const info = {
                tag: 'button',
                text: el.innerText?.slice(0, 100)?.trim(),
                testid: el.getAttribute('data-testid'),
                ariaLabel: el.getAttribute('aria-label'),
                className: el.className?.slice(0, 200),
                id: el.id
            };
            if (info.text || info.testid || info.ariaLabel || info.id) {
                results.buttons.push(info);
            }
        });

        // 提取输入框
        document.querySelectorAll('input').forEach((el, i) => {
            if (i >= 30) return;
            results.inputs.push({
                type: el.type,
                name: el.name,
                placeholder: el.placeholder,
                testid: el.getAttribute('data-testid'),
                ariaLabel: el.getAttribute('aria-label'),
                id: el.id
            });
        });

        // 提取文本域
        document.querySelectorAll('textarea').forEach((el, i) => {
            if (i >= 20) return;
            results.textareas.push({
                name: el.name,
                placeholder: el.placeholder,
                testid: el.getAttribute('data-testid'),
                ariaLabel: el.getAttribute('aria-label'),
                className: el.className?.slice(0, 200),
                id: el.id
            });
        });

        // 提取下拉框
        document.querySelectorAll('select').forEach((el, i) => {
            if (i >= 20) return;
            results.selects.push({
                name: el.name,
                testid: el.getAttribute('data-testid'),
                id: el.id,
                options: Array.from(el.options).slice(0, 10).map(o => o.text)
            });
        });

        // 提取所有带 data-testid 的元素 (增加到 200 个)
        document.querySelectorAll('[data-testid]').forEach((el, i) => {
            if (i >= 200) return;
            results.dataTestIds.push({
                tag: el.tagName.toLowerCase(),
                testid: el.getAttribute('data-testid'),
                text: el.innerText?.slice(0, 50)?.trim(),
                ariaLabel: el.getAttribute('aria-label')
            });
        });

        // 提取带 role 属性的元素 (增加到 100 个)
        document.querySelectorAll('[role]').forEach((el, i) => {
            if (i >= 100) return;
            const role = el.getAttribute('role');
            if (['button', 'menuitem', 'option', 'combobox', 'textbox', 'listbox', 'menu', 'dialog', 'tab', 'switch'].includes(role)) {
                results.roles.push({
                    tag: el.tagName.toLowerCase(),
                    role: role,
                    name: el.getAttribute('aria-label') || el.innerText?.slice(0, 50)?.trim(),
                    testid: el.getAttribute('data-testid'),
                    className: el.className?.slice(0, 100)
                });
            }
        });

        // 提取 contenteditable 元素 (常见于富文本输入)
        document.querySelectorAll('[contenteditable="true"]').forEach((el, i) => {
            if (i >= 10) return;
            results.inputs.push({
                type: 'contenteditable',
                className: el.className?.slice(0, 200),
                testid: el.getAttribute('data-testid'),
                ariaLabel: el.getAttribute('aria-label'),
                id: el.id
            });
        });

        // 新增：提取可点击的 div/span (带 onClick 或 cursor:pointer)
        document.querySelectorAll('div, span, a, svg').forEach((el, i) => {
            if (results.clickables.length >= 100) return;
            const style = window.getComputedStyle(el);
            const hasClick = el.onclick || el.getAttribute('onClick');
            const hasPointer = style.cursor === 'pointer';
            const hasTestId = el.getAttribute('data-testid');
            const hasAriaLabel = el.getAttribute('aria-label');

            // 只收集有明确标识或交互性的元素
            if ((hasClick || hasPointer) && (hasTestId || hasAriaLabel || el.id)) {
                results.clickables.push({
                    tag: el.tagName.toLowerCase(),
                    text: el.innerText?.slice(0, 50)?.trim(),
                    testid: hasTestId,
                    ariaLabel: hasAriaLabel,
                    id: el.id,
                    className: el.className?.toString()?.slice(0, 100)
                });
            }
        });

        return results;
    });

    // 格式化输出
    let output = `# 页面元素探测结果\nURL: ${url}\n\n`;

    if (elements.buttons.length > 0) {
        output += `## 按钮 (${elements.buttons.length})\n`;
        elements.buttons.forEach(b => {
            const selectors = [];
            if (b.testid) selectors.push(`[data-testid="${b.testid}"]`);
            if (b.id) selectors.push(`#${b.id}`);
            if (b.ariaLabel) selectors.push(`[aria-label="${b.ariaLabel}"]`);
            output += `- "${b.text || '(无文本)'}"\n  选择器: ${selectors.join(' | ') || b.className || '(需使用其他方式)'}\n`;
        });
        output += '\n';
    }

    if (elements.inputs.length > 0) {
        output += `## 输入框 (${elements.inputs.length})\n`;
        elements.inputs.forEach(inp => {
            const selectors = [];
            if (inp.testid) selectors.push(`[data-testid="${inp.testid}"]`);
            if (inp.id) selectors.push(`#${inp.id}`);
            if (inp.name) selectors.push(`[name="${inp.name}"]`);
            output += `- type=${inp.type || 'text'} placeholder="${inp.placeholder || ''}"\n  选择器: ${selectors.join(' | ') || inp.className || '(需使用其他方式)'}\n`;
        });
        output += '\n';
    }

    if (elements.textareas.length > 0) {
        output += `## 文本域 (${elements.textareas.length})\n`;
        elements.textareas.forEach(ta => {
            const selectors = [];
            if (ta.testid) selectors.push(`[data-testid="${ta.testid}"]`);
            if (ta.id) selectors.push(`#${ta.id}`);
            output += `- placeholder="${ta.placeholder || ''}"\n  选择器: ${selectors.join(' | ') || ta.className || '(需使用其他方式)'}\n`;
        });
        output += '\n';
    }

    if (elements.dataTestIds.length > 0) {
        output += `## data-testid 元素 (${elements.dataTestIds.length})\n`;
        elements.dataTestIds.forEach(el => {
            output += `- <${el.tag}> [data-testid="${el.testid}"] "${el.text || ''}"\n`;
        });
        output += '\n';
    }

    if (elements.roles.length > 0) {
        output += `## ARIA Role 元素 (${elements.roles.length})\n`;
        elements.roles.forEach(el => {
            output += `- <${el.tag} role="${el.role}"> "${el.name || ''}"${el.testid ? ` [data-testid="${el.testid}"]` : ''}${el.className ? ` class="${el.className}"` : ''}\n`;
        });
        output += '\n';
    }

    if (elements.clickables.length > 0) {
        output += `## 可点击元素 (${elements.clickables.length})\n`;
        elements.clickables.forEach(el => {
            const selectors = [];
            if (el.testid) selectors.push(`[data-testid="${el.testid}"]`);
            if (el.id) selectors.push(`#${el.id}`);
            if (el.ariaLabel) selectors.push(`[aria-label="${el.ariaLabel}"]`);
            output += `- <${el.tag}> "${el.text || '(无文本)'}"\n  选择器: ${selectors.join(' | ') || el.className || '(需使用其他方式)'}\n`;
        });
        output += '\n';
    }

    logger.info('适配器', `元素探测完成，共发现 ${elements.buttons.length} 个按钮, ${elements.inputs.length} 个输入框, ${elements.clickables.length} 个可点击元素`, meta);

    return { text: output };
}

/**
 * 主生成函数
 */
async function generate(context, prompt, imgPaths, modelId, meta = {}) {
    const { page } = context;

    try {
        // 查找模型配置
        const modelConfig = manifest.models.find(m => m.id === modelId);
        if (!modelConfig) {
            return { error: `未找到模型配置: ${modelId}` };
        }

        const { url, type } = modelConfig;

        // 根据模型 ID 和类型分发处理
        switch (modelId) {
            case 'cloudflare-turnstile':
                return await handleTurnstile(page, meta);
            case 'ping0':
                return await handlePing0(page, url, meta);
            case 'inspect':
                return await handleInspect(page, prompt, meta);
            case 'record':
                return await handleRecord(page, prompt, meta);
            default:
                // 根据类型分发
                return type === 'text'
                    ? await handleTextPage(page, url, meta)
                    : await handleImagePage(page, url, meta);
        }

    } catch (err) {
        const pageError = normalizePageError(err, meta);
        if (pageError) return pageError;

        logger.error('适配器', '任务失败', { ...meta, error: err.message });
        return { error: `任务失败: ${err.message}` };
    } finally { }
}

/**
 * 适配器 manifest
 */
export const manifest = {
    id: 'test',
    displayName: '浏览器检测，仅供调试使用',
    description: '包含 Cloudflare Turnstile 验证测试、浏览器指纹检测、IP 纯净度查询等功能，仅供调试使用。',

    getTargetUrl(config, workerConfig) {
        return 'https://abrahamjuliot.github.io/creepjs/';
    },

    models: [
        { id: 'inspect', imagePolicy: 'forbidden', type: 'text', url: '' },  // 元素探测，URL 通过 prompt 传入
        { id: 'record', imagePolicy: 'forbidden', type: 'text', url: '' },   // 行为录制，URL 和时长通过 prompt 传入
        { id: 'cloudflare-turnstile', imagePolicy: 'forbidden', type: 'image', url: 'https://nopecha.com/captcha/turnstile' },
        { id: 'creepjs', imagePolicy: 'forbidden', type: 'image', url: 'https://abrahamjuliot.github.io/creepjs/' },
        { id: 'antibot', imagePolicy: 'forbidden', type: 'image', url: 'https://bot.sannysoft.com/' },
        { id: 'browserleaks-js', imagePolicy: 'forbidden', type: 'image', url: 'https://browserleaks.com/javascript' },
        { id: 'browserleaks-ip', imagePolicy: 'forbidden', type: 'image', url: 'https://browserleaks.com/ip' },
        { id: 'ip', imagePolicy: 'forbidden', type: 'text', url: 'https://api.ip.sb/ip' },
        { id: 'webgl', imagePolicy: 'forbidden', type: 'image', url: 'https://get.webgl.org/' },
        { id: 'ping0', imagePolicy: 'forbidden', type: 'image', url: 'https://ping0.cc/' },
    ],

    navigationHandlers: [],
    generate
};
