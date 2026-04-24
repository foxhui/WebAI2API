/**
 * @fileoverview DeepSeek 文本生成适配器
 * @description 支持 DeepSeek V4 快速模式/专家模式，深度思考和智能搜索
 */

import {
    sleep,
    humanType,
    safeClick
} from '../engine/utils.js';
import {
    normalizePageError,
    waitForInput,
    gotoWithCheck
} from '../utils/index.js';
import { logger } from '../../utils/logger.js';

// --- 配置常量 ---
const TARGET_URL = 'https://chat.deepseek.com/';
const INPUT_SELECTOR = 'textarea';

// --- 模式名称 (中英文兼容) ---
const MODE_QUICK = ['快速模式', 'Instant'];
const MODE_EXPERT = ['专家模式', 'Expert'];

// --- 功能按钮名称 (中英文兼容) ---
const BTN_THINKING = ['深度思考', 'DeepThink'];
const BTN_SEARCH = ['智能搜索', 'Search'];
const BTN_NEW_CHAT = ['新对话', 'New Chat'];

/**
 * 按名称列表查找并操作 Playwright locator (兼容中英文)
 * @param {import('playwright-core').Page} page - 页面对象
 * @param {string[]} names - 名称列表 (中英文)
 * @param {'radio'|'button'} role - 元素角色
 * @returns {Promise<import('playwright-core').Locator|null>} 匹配的 locator 或 null
 */
async function findByName(page, names, role) {
    for (const name of names) {
        const locator = page.getByRole(role, { name });
        if (await locator.count() > 0) return locator;
    }
    return null;
}

/**
 * 切换模式 (快速模式 / 专家模式，兼容中英文)
 * @param {import('playwright-core').Page} page - 页面对象
 * @param {string[]} modeNames - 模式名称列表 (中英文)
 * @param {object} meta - 日志元数据
 * @returns {Promise<boolean>} 是否成功切换
 */
async function switchMode(page, modeNames, meta = {}) {
    try {
        const radio = await findByName(page, modeNames, 'radio');
        if (!radio) {
            logger.debug('适配器', `未找到模式选项: ${modeNames.join('/')}`, meta);
            return false;
        }

        const isChecked = await radio.isChecked();
        if (!isChecked) {
            logger.info('适配器', `切换模式: -> ${modeNames[0]}`, meta);
            await safeClick(page, radio, { bias: 'button' });
            await sleep(500, 800);
            return true;
        } else {
            logger.debug('适配器', `已是 ${modeNames[0]} 模式`, meta);
            return true;
        }
    } catch (e) {
        logger.warn('适配器', `切换模式 ${modeNames[0]} 失败: ${e.message}`, meta);
        return false;
    }
}

/**
 * 切换功能按钮状态 (兼容中英文)
 * @param {import('playwright-core').Page} page - 页面对象
 * @param {string[]} buttonNames - 按钮名称列表 (中英文)
 * @param {boolean} targetState - 目标状态 (true=开启, false=关闭)
 * @param {object} meta - 日志元数据
 * @returns {Promise<boolean>} 是否成功切换
 */
async function toggleButton(page, buttonNames, targetState, meta = {}) {
    try {
        const btn = await findByName(page, buttonNames, 'button');
        if (!btn) {
            logger.debug('适配器', `未找到按钮: ${buttonNames.join('/')}`, meta);
            return false;
        }

        // 获取当前状态 (检查 class 是否包含 ds-toggle-button--selected)
        const isSelected = await btn.evaluate(el => el.classList.contains('ds-toggle-button--selected'));

        if (isSelected !== targetState) {
            logger.info('适配器', `切换 ${buttonNames[0]}: ${isSelected} -> ${targetState}`, meta);
            await safeClick(page, btn, { bias: 'button' });
            await sleep(300, 500);
            return true;
        } else {
            logger.debug('适配器', `${buttonNames[0]} 已是目标状态: ${targetState}`, meta);
            return true;
        }
    } catch (e) {
        logger.warn('适配器', `切换 ${buttonNames[0]} 失败: ${e.message}`, meta);
        return false;
    }
}

/**
 * 配置模型功能 (模式切换 + thinking / search，兼容中英文)
 * @param {import('playwright-core').Page} page - 页面对象
 * @param {object} modelConfig - 模型配置
 * @param {object} meta - 日志元数据
 */
async function configureModel(page, modelConfig, meta = {}) {
    const expert = modelConfig?.expert || false;
    const thinking = modelConfig?.thinking || false;
    const search = modelConfig?.search || false;

    // 切换模式 (快速模式 / 专家模式)
    await switchMode(page, expert ? MODE_EXPERT : MODE_QUICK, meta);
    await sleep(200, 400);

    // 切换深度思考状态
    await toggleButton(page, BTN_THINKING, thinking, meta);
    await sleep(200, 400);

    // 切换智能搜索状态
    await toggleButton(page, BTN_SEARCH, search, meta);
    await sleep(200, 400);
}

/**
 * 执行文本生成任务
 * @param {object} context - 浏览器上下文 { page, config }
 * @param {string} prompt - 提示词
 * @param {string[]} imgPaths - 图片路径数组 (此适配器不支持)
 * @param {string} [modelId] - 模型 ID
 * @param {object} [meta={}] - 日志元数据
 * @returns {Promise<{text?: string, reasoning?: string, error?: string}>}
 */
async function generate(context, prompt, imgPaths, modelId, meta = {}) {
    const { page, config } = context;
    const waitTimeout = config?.backend?.pool?.waitTimeout ?? 120000;

    try {
        // 智能导航：如果已在 DeepSeek 对话页面，直接继续对话；否则导航到首页
        const currentUrl = page.url();
        const isOnDeepSeek = currentUrl.includes('chat.deepseek.com');
        const isInConversation = isOnDeepSeek && currentUrl !== TARGET_URL && currentUrl !== TARGET_URL.slice(0, -1);
        if (isInConversation) {
            logger.info('适配器', '继续当前对话...', meta);
        } else if (isOnDeepSeek) {
            // 在首页但没有对话，直接使用
            logger.info('适配器', '已在 DeepSeek 首页，开始新对话...', meta);
        } else {
            logger.info('适配器', '导航到 DeepSeek...', meta);
            await gotoWithCheck(page, TARGET_URL);
        }

        // 1. 等待输入框加载
        await waitForInput(page, INPUT_SELECTOR, { click: false });

        // 2. 配置模型功能 (thinking / search)
        const modelConfig = manifest.models.find(m => m.id === modelId);
        if (modelConfig) {
            await configureModel(page, modelConfig, meta);
        }

        // 3. 输入提示词
        logger.info('适配器', '输入提示词...', meta);
        await safeClick(page, INPUT_SELECTOR, { bias: 'input' });
        await humanType(page, INPUT_SELECTOR, prompt);
        await sleep(300, 500);

        // 4. 先启动 API 监听
        logger.debug('适配器', '启动 API 监听...', meta);

        let textContent = '';
        let thinkingContent = '';  // thinking 内容
        let isComplete = false;
        let isCollecting = false;  // 当前最后一个 fragment 是否为 RESPONSE 类型
        let isCollectingThinking = false;  // 是否正在收集 thinking

        const responsePromise = page.waitForResponse(async (response) => {
            const url = response.url();
            if (!url.includes('chat/completion')) return false;
            if (response.request().method() !== 'POST') return false;
            if (response.status() !== 200) return false;

            try {
                const body = await response.text();
                const lines = body.split('\n');

                for (const line of lines) {
                    // 跳过事件行和空行
                    if (line.startsWith('event:') || !line.startsWith('data:')) continue;

                    const dataStr = line.slice(5).trim();
                    if (!dataStr || dataStr === '{}') continue;

                    try {
                        const data = JSON.parse(dataStr);

                        // --- 处理 fragment 列表变更，更新 isCollecting 状态 ---

                        // 初始响应中可能已有 fragments (如 THINK / SEARCH / RESPONSE)
                        if (data.v?.response?.fragments && Array.isArray(data.v.response.fragments)) {
                            for (const fragment of data.v.response.fragments) {
                                if (fragment.type === 'RESPONSE') {
                                    isCollecting = true;
                                    isCollectingThinking = false;
                                    if (fragment.content) textContent += fragment.content;
                                } else if (fragment.type === 'THINK') {
                                    // DeepSeek 使用 THINK (不是 THINKING)
                                    isCollectingThinking = true;
                                    isCollecting = false;
                                    if (fragment.content) thinkingContent += fragment.content;
                                } else {
                                    isCollecting = false;
                                    isCollectingThinking = false;
                                }
                            }
                        }

                        // fragments APPEND - 新增 fragment (非 BATCH)
                        if (data.p === 'response/fragments' && data.o === 'APPEND' && Array.isArray(data.v)) {
                            for (const fragment of data.v) {
                                if (fragment.type === 'RESPONSE') {
                                    isCollecting = true;
                                    isCollectingThinking = false;
                                    if (fragment.content) textContent += fragment.content;
                                } else if (fragment.type === 'THINK') {
                                    isCollectingThinking = true;
                                    isCollecting = false;
                                    if (fragment.content) thinkingContent += fragment.content;
                                } else {
                                    isCollecting = false;
                                    isCollectingThinking = false;
                                }
                            }
                        }

                        // BATCH 操作中的 fragments
                        if (data.o === 'BATCH' && data.p === 'response' && Array.isArray(data.v)) {
                            for (const item of data.v) {
                                if (item.p === 'fragments' && item.o === 'APPEND' && Array.isArray(item.v)) {
                                    for (const fragment of item.v) {
                                        if (fragment.type === 'RESPONSE') {
                                            isCollecting = true;
                                            isCollectingThinking = false;
                                            if (fragment.content) textContent += fragment.content;
                                        } else if (fragment.type === 'THINK') {
                                            isCollectingThinking = true;
                                            isCollecting = false;
                                            if (fragment.content) thinkingContent += fragment.content;
                                        } else {
                                            isCollecting = false;
                                            isCollectingThinking = false;
                                        }
                                    }
                                }
                                // 检查是否完成 (quasi_status 或 status)
                                if ((item.p === 'status' || item.p === 'quasi_status') && item.v === 'FINISHED') {
                                    isComplete = true;
                                }
                            }
                        }

                        // --- 处理文本内容追加 ---

                        // 带路径的 content 操作 (如 response/fragments/-1/content)
                        if (data.p && typeof data.v === 'string') {
                            const match = data.p.match(/response\/fragments\/(-?\d+)\/content/);
                            if (match) {
                                if (isCollecting) {
                                    textContent += data.v;
                                } else if (isCollectingThinking) {
                                    thinkingContent += data.v;
                                }
                            }
                        }

                        // 纯文本追加 (只有 v 字符串，没有 p 和 o)
                        if (data.v && typeof data.v === 'string' && !data.p && !data.o) {
                            if (isCollecting) {
                                textContent += data.v;
                            } else if (isCollectingThinking) {
                                thinkingContent += data.v;
                            }
                        }

                        // --- 检查完成信号 ---

                        // 独立的 status SET 操作
                        if (data.p === 'response/status' && data.o === 'SET' && data.v === 'FINISHED') {
                            isComplete = true;
                        }
                    } catch {
                        // 忽略解析错误
                    }
                }

                return isComplete;
            } catch {
                return false;
            }
        }, { timeout: waitTimeout });

        // 5. 发送提示词
        logger.debug('适配器', '发送提示词...', meta);
        await page.keyboard.press('Enter');

        logger.info('适配器', '等待生成结果...', meta);

        // 6. 等待 API 响应
        try {
            await responsePromise;
        } catch (e) {
            const pageError = normalizePageError(e, meta);
            if (pageError) return pageError;
            throw e;
        }

        if (!textContent || textContent.trim() === '') {
            logger.warn('适配器', '回复内容为空', meta);
            return { error: '回复内容为空' };
        }

        logger.info('适配器', `已获取文本内容 (${textContent.length} 字符)`, meta);
        logger.info('适配器', '文本生成完成，任务完成', meta);

        const trimmedThinking = thinkingContent.trim();
        const result = { text: textContent.trim() };

        // 返回结果（如果有 thinking 则包含 reasoning）
        if (trimmedThinking) {
            logger.info('适配器', `已获取思考过程 (${trimmedThinking.length} 字符)`, meta);
            result.reasoning = trimmedThinking;
        }
        return result;

    } catch (err) {
        // 顶层错误处理
        const pageError = normalizePageError(err, meta);
        if (pageError) return pageError;
        logger.error('适配器', '生成任务失败', { ...meta, error: err.message });
        return { error: `生成任务失败: ${err.message}` };
    } finally { }
}

/**
 * 适配器 manifest
 */
export const manifest = {
    id: 'deepseek_text',
    displayName: 'DeepSeek (文本生成)',
    description: '使用 DeepSeek V4 官网生成文本，支持快速模式/专家模式、深度思考和智能搜索。需要已登录的 DeepSeek 账户。',

    // 入口 URL
    getTargetUrl(config, workerConfig) {
        return TARGET_URL;
    },

    // 模型列表 (DeepSeek V4)
    models: [
        // 快速模式 (deepseek-v4-flash)
        { id: 'deepseek-v4-flash', imagePolicy: 'forbidden' },
        { id: 'deepseek-v4-flash-thinking', imagePolicy: 'forbidden', thinking: true },
        { id: 'deepseek-v4-flash-search', imagePolicy: 'forbidden', search: true },
        { id: 'deepseek-v4-flash-thinking-search', imagePolicy: 'forbidden', thinking: true, search: true },
        // 专家模式 (deepseek-v4-pro)
        { id: 'deepseek-v4-pro', imagePolicy: 'forbidden', expert: true },
        { id: 'deepseek-v4-pro-thinking', imagePolicy: 'forbidden', expert: true, thinking: true },
        { id: 'deepseek-v4-pro-search', imagePolicy: 'forbidden', expert: true, search: true },
        { id: 'deepseek-v4-pro-thinking-search', imagePolicy: 'forbidden', expert: true, thinking: true, search: true },
    ],

    // 无需导航处理器
    navigationHandlers: [],

    // 核心文本生成方法
    generate
};
