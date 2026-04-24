/**
 * DeepSeek 适配器 E2E 测试
 * @description 测试 DeepSeek V4 界面交互：模式切换、功能按钮、文本生成
 * @note 自动检测界面语言，兼容中英文
 */

import { test, expect } from '@playwright/test';
import { manifest } from '../src/backend/adapter/deepseek_text.js';

const TARGET_URL = 'https://chat.deepseek.com/';

// --- 辅助函数 ---

/** 检测页面 locale 并返回对应的名称映射 */
async function detectLocale(page) {
    const ph = await page.locator('textarea').getAttribute('placeholder');
    const isZh = ph?.includes('给 DeepSeek') ?? false;
    return {
        isZh,
        modeQuick: isZh ? '快速模式' : 'Instant',
        modeExpert: isZh ? '专家模式' : 'Expert',
        btnThinking: isZh ? '深度思考' : 'DeepThink',
        btnSearch: isZh ? '智能搜索' : 'Search',
    };
}

/** 按名称列表查找 radio (兼容中英文) */
async function findRadio(page, names) {
    for (const name of names) {
        const loc = page.getByRole('radio', { name });
        if (await loc.count() > 0) return loc;
    }
    return null;
}

/** 按名称列表查找 button (兼容中英文) */
async function findButton(page, names) {
    for (const name of names) {
        const loc = page.getByRole('button', { name });
        if (await loc.count() > 0) return loc;
    }
    return null;
}

/** 解析 SSE 响应中的文本和思考内容 (完整版，兼容所有 DeepSeek SSE 格式) */
function parseSSEResponse(body) {
    let text = '', thinking = '';
    let isCollecting = false, isCollectingThinking = false;

    for (const line of body.split('\n')) {
        if (line.startsWith('event:') || !line.startsWith('data:')) continue;
        const dataStr = line.slice(5).trim();
        if (!dataStr || dataStr === '{}') continue;
        try {
            const data = JSON.parse(dataStr);

            // 处理 fragment 列表
            const processFragment = (fragment) => {
                if (fragment.type === 'RESPONSE') {
                    isCollecting = true; isCollectingThinking = false;
                    if (fragment.content) text += fragment.content;
                } else if (fragment.type === 'THINK') {
                    isCollectingThinking = true; isCollecting = false;
                    if (fragment.content) thinking += fragment.content;
                } else {
                    isCollecting = false; isCollectingThinking = false;
                }
            };

            // 初始响应中的 fragments
            if (data.v?.response?.fragments && Array.isArray(data.v.response.fragments)) {
                data.v.response.fragments.forEach(processFragment);
            }

            // fragments APPEND
            if (data.p === 'response/fragments' && data.o === 'APPEND' && Array.isArray(data.v)) {
                data.v.forEach(processFragment);
            }

            // BATCH 操作
            if (data.o === 'BATCH' && data.p === 'response' && Array.isArray(data.v)) {
                for (const item of data.v) {
                    if (item.p === 'fragments' && item.o === 'APPEND' && Array.isArray(item.v)) {
                        item.v.forEach(processFragment);
                    }
                }
            }

            // 路径式内容追加 (response/fragments/-1/content)
            if (data.p && typeof data.v === 'string') {
                const match = data.p.match(/response\/fragments\/(-?\d+)\/content/);
                if (match) {
                    if (isCollecting) text += data.v;
                    else if (isCollectingThinking) thinking += data.v;
                }
            }

            // 纯文本追加
            if (data.v && typeof data.v === 'string' && !data.p && !data.o) {
                if (isCollecting) text += data.v;
                else if (isCollectingThinking) thinking += data.v;
            }
        } catch { /* 忽略 */ }
    }
    return { text, thinking };
}

// --- Manifest 结构测试 (无需浏览器) ---

test.describe('Manifest 结构验证', () => {
    test('manifest 包含必要字段', () => {
        expect(manifest.id).toBe('deepseek_text');
        expect(manifest.displayName).toBeTruthy();
        expect(manifest.description).toBeTruthy();
        expect(typeof manifest.generate).toBe('function');
        expect(Array.isArray(manifest.models)).toBe(true);
        expect(manifest.models.length).toBe(8);
    });

    test('所有模型包含必要属性', () => {
        for (const model of manifest.models) {
            expect(model.id).toBeTruthy();
            expect(model.imagePolicy).toBe('forbidden');
        }
    });

    test('快速模式模型 (deepseek-v4-flash)', () => {
        const flashModels = manifest.models.filter(m => m.id.startsWith('deepseek-v4-flash'));
        expect(flashModels.length).toBe(4);
        for (const m of flashModels) {
            expect(m.expert).toBeUndefined();
        }
    });

    test('专家模式模型 (deepseek-v4-pro)', () => {
        const proModels = manifest.models.filter(m => m.id.startsWith('deepseek-v4-pro'));
        expect(proModels.length).toBe(4);
        for (const m of proModels) {
            expect(m.expert).toBe(true);
        }
    });

    test('thinking/search 模型配置正确', () => {
        expect(manifest.models.filter(m => m.thinking).length).toBe(4);
        expect(manifest.models.filter(m => m.search).length).toBe(4);
    });

    test('getTargetUrl 返回正确 URL', () => {
        expect(manifest.getTargetUrl()).toBe(TARGET_URL);
    });
});

// --- 页面交互 E2E 测试 ---

test.describe('DeepSeek 页面交互', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(TARGET_URL);
        await page.waitForSelector('textarea', { timeout: 15000 });
    });

    test('页面加载后显示模式选择器', async ({ page }) => {
        const quickMode = await findRadio(page, ['快速模式', 'Instant']);
        const expertMode = await findRadio(page, ['专家模式', 'Expert']);
        expect(quickMode).not.toBeNull();
        expect(expertMode).not.toBeNull();
    });

    test('页面加载后显示功能按钮', async ({ page }) => {
        const thinkingBtn = await findButton(page, ['深度思考', 'DeepThink']);
        const searchBtn = await findButton(page, ['智能搜索', 'Search']);
        expect(thinkingBtn).not.toBeNull();
        expect(searchBtn).not.toBeNull();
    });

    test('页面加载后显示输入框', async ({ page }) => {
        const textarea = page.locator('textarea');
        await expect(textarea).toBeVisible();
        const ph = await textarea.getAttribute('placeholder');
        expect(ph).toBeTruthy();
    });

    test('默认选中快速模式', async ({ page }) => {
        const quickMode = await findRadio(page, ['快速模式', 'Instant']);
        expect(quickMode).not.toBeNull();
        await expect(quickMode).toBeChecked();
    });
});

// --- 模式切换测试 ---

test.describe('模式切换', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(TARGET_URL);
        await page.waitForSelector('textarea', { timeout: 15000 });
    });

    test('切换到专家模式', async ({ page }) => {
        const expertMode = await findRadio(page, ['专家模式', 'Expert']);
        expect(expertMode).not.toBeNull();
        await expertMode.click();
        await expect(expertMode).toBeChecked();
    });

    test('切换回快速模式', async ({ page }) => {
        const quickMode = await findRadio(page, ['快速模式', 'Instant']);
        const expertMode = await findRadio(page, ['专家模式', 'Expert']);
        expect(quickMode).not.toBeNull();
        expect(expertMode).not.toBeNull();

        await expertMode.click();
        await expect(expertMode).toBeChecked();

        await quickMode.click();
        await expect(quickMode).toBeChecked();
    });
});

// --- 功能按钮切换测试 ---

test.describe('功能按钮切换', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(TARGET_URL);
        await page.waitForSelector('textarea', { timeout: 15000 });
    });

    test('深度思考按钮可切换', async ({ page }) => {
        const btn = await findButton(page, ['深度思考', 'DeepThink']);
        expect(btn).not.toBeNull();

        const initialSelected = await btn.evaluate(el => el.classList.contains('ds-toggle-button--selected'));
        await btn.click();
        await page.waitForTimeout(500);

        const newSelected = await btn.evaluate(el => el.classList.contains('ds-toggle-button--selected'));
        expect(newSelected).toBe(!initialSelected);
    });

    test('智能搜索按钮可切换', async ({ page }) => {
        const btn = await findButton(page, ['智能搜索', 'Search']);
        expect(btn).not.toBeNull();

        const initialSelected = await btn.evaluate(el => el.classList.contains('ds-toggle-button--selected'));
        await btn.click();
        await page.waitForTimeout(500);

        const newSelected = await btn.evaluate(el => el.classList.contains('ds-toggle-button--selected'));
        expect(newSelected).toBe(!initialSelected);
    });

    test('深度思考和智能搜索可同时开启', async ({ page }) => {
        const thinkingBtn = await findButton(page, ['深度思考', 'DeepThink']);
        const searchBtn = await findButton(page, ['智能搜索', 'Search']);
        expect(thinkingBtn).not.toBeNull();
        expect(searchBtn).not.toBeNull();

        // 确保都开启
        for (const btn of [thinkingBtn, searchBtn]) {
            const selected = await btn.evaluate(el => el.classList.contains('ds-toggle-button--selected'));
            if (!selected) {
                await btn.click();
                await page.waitForTimeout(300);
            }
        }

        // 验证都已开启
        for (const btn of [thinkingBtn, searchBtn]) {
            const selected = await btn.evaluate(el => el.classList.contains('ds-toggle-button--selected'));
            expect(selected).toBe(true);
        }
    });
});

// --- 文本生成 E2E 测试 ---

test.describe('文本生成', () => {
    test('快速模式发送消息并获取回复', async ({ page }) => {
        await page.goto(TARGET_URL);
        await page.waitForSelector('textarea', { timeout: 15000 });

        const textarea = page.locator('textarea');
        const quickMode = await findRadio(page, ['快速模式', 'Instant']);

        // 确保在快速模式
        if (quickMode && !(await quickMode.isChecked())) {
            await quickMode.click();
            await page.waitForTimeout(500);
        }

        // 关闭深度思考和搜索
        for (const names of [['深度思考', 'DeepThink'], ['智能搜索', 'Search']]) {
            const btn = await findButton(page, names);
            if (btn && await btn.evaluate(el => el.classList.contains('ds-toggle-button--selected'))) {
                await btn.click();
                await page.waitForTimeout(300);
            }
        }

        const responsePromise = page.waitForResponse(
            resp => resp.url().includes('chat/completion') && resp.request().method() === 'POST',
            { timeout: 60000 }
        );

        await textarea.click();
        await textarea.fill('Reply with exactly: hello');
        await page.keyboard.press('Enter');

        const response = await responsePromise;
        expect(response.status()).toBe(200);
        const { text } = parseSSEResponse(await response.text());
        expect(text.length).toBeGreaterThan(0);
        console.log(`[快速模式] 回复 (${text.length}字符): ${text.slice(0, 80)}...`);
    });

    test('专家模式发送消息并获取回复', async ({ page }) => {
        await page.goto(TARGET_URL);
        await page.waitForSelector('textarea', { timeout: 15000 });

        const textarea = page.locator('textarea');
        const expertMode = await findRadio(page, ['专家模式', 'Expert']);
        expect(expertMode).not.toBeNull();
        await expertMode.click();
        await page.waitForTimeout(800);

        const responsePromise = page.waitForResponse(
            resp => resp.url().includes('chat/completion') && resp.request().method() === 'POST',
            { timeout: 90000 }
        );

        await textarea.click();
        await textarea.fill('Reply with exactly: 2');
        await page.keyboard.press('Enter');

        const response = await responsePromise;
        expect(response.status()).toBe(200);
        const { text } = parseSSEResponse(await response.text());
        expect(text.length).toBeGreaterThan(0);
        console.log(`[专家模式] 回复 (${text.length}字符): ${text.slice(0, 80)}...`);
    });

    test('深度思考模式返回 reasoning 内容', async ({ page }) => {
        await page.goto(TARGET_URL);
        await page.waitForSelector('textarea', { timeout: 15000 });

        const textarea = page.locator('textarea');
        const thinkingBtn = await findButton(page, ['深度思考', 'DeepThink']);
        expect(thinkingBtn).not.toBeNull();

        // 开启深度思考
        if (!await thinkingBtn.evaluate(el => el.classList.contains('ds-toggle-button--selected'))) {
            await thinkingBtn.click();
            await page.waitForTimeout(500);
        }

        const responsePromise = page.waitForResponse(
            resp => resp.url().includes('chat/completion') && resp.request().method() === 'POST',
            { timeout: 90000 }
        );

        await textarea.click();
        await textarea.fill('Why is the sky blue? One sentence.');
        await page.keyboard.press('Enter');

        const response = await responsePromise;
        expect(response.status()).toBe(200);
        const { text, thinking } = parseSSEResponse(await response.text());
        expect(text.length).toBeGreaterThan(0);
        console.log(`[深度思考] 思考(${thinking.length}字符) 回复(${text.length}字符): ${text.slice(0, 80)}...`);
    });
});
