/**
 * @fileoverview DeepSeek 文本生成适配器
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

/**
 * 切换功能按钮状态
 * @param {import('playwright-core').Page} page - 页面对象
 * @param {string} buttonName - 按钮名称 (DeepThink / Search)
 * @param {boolean} targetState - 目标状态 (true=开启, false=关闭)
 * @param {object} meta - 日志元数据
 * @returns {Promise<boolean>} 是否成功切换
 */
async function toggleButton(page, buttonName, targetState, meta = {}) {
    try {
        const btn = page.getByRole('button', { name: buttonName });
        const btnCount = await btn.count();
        if (btnCount === 0) {
            logger.debug('适配器', `未找到 ${buttonName} 按钮`, meta);
            return false;
        }

        // 获取当前状态 (检查 class 是否包含 ds-toggle-button--selected)
        const isSelected = await btn.evaluate(el => el.classList.contains('ds-toggle-button--selected'));

        if (isSelected !== targetState) {
            logger.info('适配器', `切换 ${buttonName}: ${isSelected} -> ${targetState}`, meta);
            await safeClick(page, btn, { bias: 'button' });
            await sleep(300, 500);
            return true;
        } else {
            logger.debug('适配器', `${buttonName} 已是目标状态: ${targetState}`, meta);
            return true;
        }
    } catch (e) {
        logger.warn('适配器', `切换 ${buttonName} 失败: ${e.message}`, meta);
        return false;
    }
}

/**
 * 配置模型功能 (thinking / search)
 * @param {import('playwright-core').Page} page - 页面对象
 * @param {object} modelConfig - 模型配置
 * @param {object} meta - 日志元数据
 */
async function configureModel(page, modelConfig, meta = {}) {
    const thinking = modelConfig?.thinking || false;
    const search = modelConfig?.search || false;

    // 切换 DeepThink 状态
    await toggleButton(page, 'DeepThink', thinking, meta);
    await sleep(200, 400);

    // 切换 Search 状态
    await toggleButton(page, 'Search', search, meta);
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
        logger.info('适配器', '开启新会话...', meta);
        await gotoWithCheck(page, TARGET_URL);

        // 1. 等待输入框加载
        await waitForInput(page, INPUT_SELECTOR, { click: false });

        // 1.5 切换基础/专业模式 (Instant / Expert)
        try {
            const isExpert = modelId ? modelId.endsWith('-expert') : false;
            const targetType = isExpert ? 'expert' : 'default';
            const modeBtn = page.locator(`div[data-model-type="${targetType}"]`).first();
            
            if (await modeBtn.count() > 0) {
                logger.info('适配器', `切换 ${isExpert ? 'Expert' : 'Instant'} 模式...`, meta);
                await safeClick(page, modeBtn, { bias: 'button' });
                await sleep(300, 500);
            }
        } catch (e) {
            logger.debug('适配器', `模式切换异常 (部分账号可能无此入口): ${e.message}`, meta);
        }

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
    description: '使用 DeepSeek 官网生成文本，支持 DeepThink 深度思考和 Search 搜索模式。需要已登录的 DeepSeek 账户。',

    // 入口 URL
    getTargetUrl(config, workerConfig) {
        return TARGET_URL;
    },

    // 模型列表
    models: [
        { id: 'deepseek', imagePolicy: 'forbidden', type: 'text' },
        { id: 'deepseek-thinking', imagePolicy: 'forbidden', thinking: true, type: 'text' },
        { id: 'deepseek-search', imagePolicy: 'forbidden', search: true, type: 'text' },
        { id: 'deepseek-thinking-search', imagePolicy: 'forbidden', thinking: true, search: true, type: 'text' },
        { id: 'deepseek-expert', imagePolicy: 'forbidden', type: 'text' },
        { id: 'deepseek-thinking-expert', imagePolicy: 'forbidden', thinking: true, type: 'text' },
        { id: 'deepseek-search-expert', imagePolicy: 'forbidden', search: true, type: 'text' },
        { id: 'deepseek-thinking-search-expert', imagePolicy: 'forbidden', thinking: true, search: true, type: 'text' },
    ],

    // 无需导航处理器
    navigationHandlers: [],

    // 核心文本生成方法
    generate
};
