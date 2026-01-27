/**
 * @fileoverview LMArena 文本生成适配器
 */

import {
    sleep,
    humanType,
    safeClick,
    pasteImages
} from '../engine/utils.js';
import {
    waitApiResponse,
    normalizePageError,
    normalizeHttpError,
    waitForInput,
    gotoWithCheck
} from '../utils/index.js';
import { logger } from '../../utils/logger.js';

// --- 配置常量 ---
const TARGET_URL = 'https://lmarena.ai/c/new?mode=direct&chat-modality=chat';
const TARGET_URL_SEARCH = 'https://lmarena.ai/zh/c/new?mode=direct&chat-modality=search';

/**
 * 执行生图任务
 * @param {object} context - 浏览器上下文 { page, client }
 * @param {string} prompt - 提示词
 * @param {string[]} imgPaths - 图片路径数组
 * @param {string} [modelId] - 指定的模型 ID (可选)
 * @param {object} [meta={}] - 日志元数据
 * @returns {Promise<{image?: string, text?: string, error?: string}>} 生成结果
 */
async function generate(context, prompt, imgPaths, modelId, meta = {}) {
    const { page } = context;
    const textareaSelector = 'textarea';

    // Worker 已验证，直接解析模型配置
    const modelConfig = manifest.models.find(m => m.id === modelId);
    const { search } = modelConfig || {};
    const targetUrl = search ? TARGET_URL_SEARCH : TARGET_URL;

    try {
        logger.info('适配器', `开启新会话... (搜索模式: ${!!search})`, meta);
        await gotoWithCheck(page, targetUrl);

        // 1. 等待输入框加载
        await waitForInput(page, textareaSelector, { click: false });

        // 2. 选择模型
        if (modelId) {
            logger.debug('适配器', `选择模型: ${modelId}`, meta);
            // 使用键盘导航展开模型选择框：按两次 Shift+Tab 然后 Enter
            await page.keyboard.down('Shift');
            await page.keyboard.press('Tab');
            await page.keyboard.press('Tab');
            await page.keyboard.up('Shift');
            await sleep(100, 200);
            await page.keyboard.press('Enter');

            // 获取模型配置，优先使用 codeName，否则使用 id
            const searchText = modelConfig?.codeName || modelId;

            // 模拟粘贴输入模型名称
            await page.evaluate((text) => {
                document.execCommand('insertText', false, text);
            }, searchText);

            // 等待过滤完成：第一个选项包含目标模型的主 ID
            // searchText 可能是 codeName（含括号说明），但过滤后的选项应该包含 modelId
            try {
                await page.waitForFunction(
                    (targetId) => {
                        const firstOption = document.querySelector('[role="option"]');
                        return firstOption && firstOption.textContent?.includes(targetId);
                    },
                    modelId,
                    { timeout: 5000 }
                );
            } catch {
                // 超时也继续，可能列表结构不同
                logger.debug('适配器', `等待模型选项过滤超时，继续执行`, meta);
            }
            await sleep(300, 500);
            await page.keyboard.press('Enter');
        }

        // 3. 上传图片
        if (imgPaths && imgPaths.length > 0) {
            logger.info('适配器', `开始上传 ${imgPaths.length} 张图片`, meta);
            await pasteImages(page, textareaSelector, imgPaths, {}, meta);
            logger.info('适配器', '图片上传完成', meta);
        }

        // 4. 填写提示词
        await safeClick(page, textareaSelector, { bias: 'input' });
        logger.info('适配器', '输入提示词...', meta);
        await humanType(page, textareaSelector, prompt);

        // 5. 先启动 API 监听
        logger.debug('适配器', '启动 API 监听...', meta);
        const responsePromise = waitApiResponse(page, {
            urlMatch: '/nextjs-api/stream',
            method: 'POST',
            timeout: 120000,
            meta
        });

        // 6. 发送提示词
        logger.info('适配器', '发送提示词...', meta);
        await safeClick(page, 'button[type="submit"]', { bias: 'button' });

        logger.info('适配器', '等待生成结果...', meta);

        // 7. 等待 API 响应
        let response;
        try {
            response = await responsePromise;
        } catch (e) {
            // 使用公共错误处理
            const pageError = normalizePageError(e, meta);
            if (pageError) return pageError;
            throw e;
        }

        // 7. 解析响应结果
        const content = await response.text();

        // 8. 检查 HTTP 错误
        const httpError = normalizeHttpError(response, content);
        if (httpError) {
            logger.error('适配器', `请求生成时返回错误: ${httpError.error}`, meta);
            return { error: `请求生成时返回错误: ${httpError.error}` };
        }

        // 9. 解析文本流
        // 格式示例:
        // a0:"Hello"
        // a0:" World"
        // d:{"finishReason":"stop"}
        let fullText = '';
        const lines = content.split('\n');

        for (const line of lines) {
            if (line.startsWith('a0:')) {
                try {
                    // 尝试解析 JSON 字符串内容
                    // line.substring(3) 应该是 JSON 字符串，如 "Hello"
                    const textPart = JSON.parse(line.substring(3));
                    fullText += textPart;
                } catch (e) {
                    // 如果解析失败，可能是原生文本或其他格式
                    logger.warn('适配器', `解析文本块失败: ${line}`, meta);
                }
            }
        }

        if (fullText) {
            logger.info('适配器', `获取文本成功，长度: ${fullText.length}`, meta);
            return { text: fullText };
        } else {
            logger.warn('适配器', '未解析到有效文本内容', { ...meta, preview: content.substring(0, 150) });
            // 如果没解析到 a0，尝试直接返回原始内容防空
            return { error: '未解析到有效文本内容' };
        }

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
    id: 'lmarena_text',
    displayName: 'LMArena (文本生成)',
    description: '使用 LMArena 平台生成文本，支持多种大语言模型和搜索模式。需要已登录的 LMArena 账户，若不登录会频繁弹出人机验证码且有速率限制。',

    // 入口 URL
    getTargetUrl(config, workerConfig) {
        return TARGET_URL;
    },

    // 模型列表（根据最新支持列表整理）
    models: [
        // --- 文本模型 ---
        { id: 'gemini-3-pro', imagePolicy: 'optional', type: 'text' },
        { id: 'grok-4.1-thinking', imagePolicy: 'forbidden', type: 'text' },
        { id: 'gemini-3-flash', imagePolicy: 'optional', type: 'text' },
        { id: 'claude-opus-4-5-20251101-thinking-32k', imagePolicy: 'forbidden', type: 'text' },
        { id: 'claude-opus-4-5-20251101', imagePolicy: 'forbidden', type: 'text' },
        { id: 'grok-4.1', imagePolicy: 'forbidden', type: 'text' },
        { id: 'ernie-5.0-0110', imagePolicy: 'forbidden', type: 'text' },
        { id: 'gpt-5.1-high', imagePolicy: 'optional', type: 'text' },
        { id: 'gemini-2.5-pro', imagePolicy: 'optional', type: 'text' },
        { id: 'claude-sonnet-4-5-20250929-thinking-32k', imagePolicy: 'forbidden', type: 'text' },
        { id: 'ernie-5.0-preview-1203', imagePolicy: 'forbidden', type: 'text' },
        { id: 'claude-sonnet-4-5-20250929', imagePolicy: 'forbidden', type: 'text' },
        { id: 'claude-opus-4-1-20250805-thinking-16k', imagePolicy: 'forbidden', type: 'text' },
        { id: 'claude-opus-4-1-20250805', imagePolicy: 'forbidden', type: 'text' },
        { id: 'gpt-5.2', imagePolicy: 'optional', type: 'text' },
        { id: 'chatgpt-4o-latest-20250326', imagePolicy: 'optional', type: 'text' },
        { id: 'glm-4.7', imagePolicy: 'forbidden', type: 'text' },
        { id: 'gpt-5.2-high', imagePolicy: 'optional', type: 'text' },
        { id: 'gpt-5.1', imagePolicy: 'optional', type: 'text' },
        { id: 'gpt-5-high', imagePolicy: 'optional', type: 'text' },
        { id: 'qwen3-max-preview', imagePolicy: 'forbidden', type: 'text' },
        { id: 'o3-2025-04-16', imagePolicy: 'optional', type: 'text' },
        { id: 'grok-4-1-fast-reasoning', imagePolicy: 'forbidden', type: 'text' },
        { id: 'kimi-k2-thinking-turbo', imagePolicy: 'forbidden', type: 'text' },
        { id: 'gpt-5-chat', imagePolicy: 'optional', type: 'text' },
        { id: 'glm-4.6', imagePolicy: 'forbidden', type: 'text' },
        { id: 'qwen3-max-2025-09-23', imagePolicy: 'forbidden', type: 'text' },
        { id: 'claude-opus-4-20250514-thinking-16k', imagePolicy: 'forbidden', type: 'text' },
        { id: 'qwen3-235b-a22b-instruct-2507', imagePolicy: 'forbidden', type: 'text' },
        { id: 'grok-4-fast-chat', imagePolicy: 'forbidden', type: 'text' },
        { id: 'deepseek-v3.2-thinking', imagePolicy: 'forbidden', type: 'text' },
        { id: 'deepseek-v3.2', imagePolicy: 'forbidden', type: 'text' },
        { id: 'kimi-k2-0905-preview', imagePolicy: 'forbidden', type: 'text' },
        { id: 'kimi-k2-0711-preview', imagePolicy: 'forbidden', type: 'text' },
        { id: 'qwen3-vl-235b-a22b-instruct', imagePolicy: 'optional', type: 'text' },
        { id: 'claude-opus-4-20250514', imagePolicy: 'forbidden', type: 'text' },
        { id: 'gpt-4.1-2025-04-14', imagePolicy: 'optional', type: 'text' },
        { id: 'mistral-medium-2508', imagePolicy: 'optional', type: 'text' },
        { id: 'mistral-large-3', imagePolicy: 'forbidden', type: 'text' },
        { id: 'grok-4-0709', imagePolicy: 'optional', type: 'text' },
        { id: 'glm-4.5', imagePolicy: 'forbidden', type: 'text' },
        { id: 'gemini-2.5-flash', imagePolicy: 'optional', type: 'text' },
        { id: 'gemini-2.5-flash-preview-09-2025', imagePolicy: 'optional', type: 'text' },
        { id: 'grok-4-fast-reasoning', imagePolicy: 'forbidden', type: 'text' },
        { id: 'claude-haiku-4-5-20251001', imagePolicy: 'forbidden', type: 'text' },
        { id: 'qwen3-235b-a22b-no-thinking', imagePolicy: 'forbidden', type: 'text' },
        { id: 'qwen3-next-80b-a3b-instruct', imagePolicy: 'forbidden', type: 'text' },
        { id: 'claude-sonnet-4-20250514-thinking-32k', imagePolicy: 'forbidden', type: 'text' },
        { id: 'longcat-flash-chat', imagePolicy: 'forbidden', type: 'text' },
        { id: 'qwen3-235b-a22b-thinking-2507', imagePolicy: 'forbidden', type: 'text' },
        { id: 'mimo-v2-flash', imagePolicy: 'optional', type: 'text' },
        { id: 'mimo-v2-flash-thinking', codeName: 'mimo-v2-flash (thinking)', imagePolicy: 'forbidden', type: 'text' },
        { id: 'qwen3-vl-235b-a22b-thinking', imagePolicy: 'optional', type: 'text' },
        { id: 'deepseek-v3-0324', imagePolicy: 'forbidden', type: 'text' },
        { id: 'hunyuan-vision-1.5-thinking', imagePolicy: 'optional', type: 'text' },
        { id: 'o4-mini-2025-04-16', imagePolicy: 'optional', type: 'text' },
        { id: 'gpt-5-mini-high', imagePolicy: 'optional', type: 'text' },
        { id: 'claude-sonnet-4-20250514', imagePolicy: 'forbidden', type: 'text' },
        { id: 'claude-3-7-sonnet-20250219-thinking-32k', imagePolicy: 'forbidden', type: 'text' },
        { id: 'hunyuan-t1-20250711', imagePolicy: 'forbidden', type: 'text' },
        { id: 'qwen3-coder-480b-a35b-instruct', imagePolicy: 'forbidden', type: 'text' },
        { id: 'mistral-medium-2505', imagePolicy: 'optional', type: 'text' },
        { id: 'qwen3-30b-a3b-instruct-2507', imagePolicy: 'forbidden', type: 'text' },
        { id: 'gpt-4.1-mini-2025-04-14', imagePolicy: 'optional', type: 'text' },
        { id: 'minimax-m2.1-preview', imagePolicy: 'forbidden', type: 'text' },
        { id: 'gemini-2.5-flash-lite-preview-09-2025-no-thinking', imagePolicy: 'optional', type: 'text' },
        { id: 'glm-4.6v', imagePolicy: 'optional', type: 'text' },
        { id: 'gemini-2.5-flash-lite-preview-06-17-thinking', imagePolicy: 'optional', type: 'text' },
        { id: 'qwen3-235b-a22b', imagePolicy: 'forbidden', type: 'text' },
        { id: 'claude-3-5-sonnet-20241022', imagePolicy: 'forbidden', type: 'text' },
        { id: 'claude-3-7-sonnet-20250219', imagePolicy: 'forbidden', type: 'text' },
        { id: 'glm-4.5-air', imagePolicy: 'forbidden', type: 'text' },
        { id: 'qwen3-next-80b-a3b-thinking', imagePolicy: 'forbidden', type: 'text' },
        { id: 'minimax-m1', imagePolicy: 'forbidden', type: 'text' },
        { id: 'gemma-3-27b-it', imagePolicy: 'optional', type: 'text' },
        { id: 'amazon-nova-experimental-chat-11-10', imagePolicy: 'forbidden', type: 'text' },
        { id: 'grok-3-mini-high', imagePolicy: 'forbidden', type: 'text' },
        { id: 'gemini-2.0-flash-001', imagePolicy: 'optional', type: 'text' },
        { id: 'grok-3-mini-beta', imagePolicy: 'forbidden', type: 'text' },
        { id: 'mistral-small-2506', imagePolicy: 'optional', type: 'text' },
        { id: 'intellect-3', imagePolicy: 'forbidden', type: 'text' },
        { id: 'gpt-oss-120b', imagePolicy: 'forbidden', type: 'text' },
        { id: 'glm-4.5v', imagePolicy: 'optional', type: 'text' },
        { id: 'command-a-03-2025', imagePolicy: 'forbidden', type: 'text' },
        { id: 'o3-mini', imagePolicy: 'forbidden', type: 'text' },
        { id: 'ling-flash-2.0', imagePolicy: 'forbidden', type: 'text' },
        { id: 'step-3', imagePolicy: 'forbidden', type: 'text' },
        { id: 'minimax-m2', imagePolicy: 'forbidden', type: 'text' },
        { id: 'gpt-5-nano-high', imagePolicy: 'optional', type: 'text' },
        { id: 'nova-2-lite', imagePolicy: 'forbidden', type: 'text' },
        { id: 'qwq-32b', imagePolicy: 'forbidden', type: 'text' },
        { id: 'llama-4-maverick-17b-128e-instruct', imagePolicy: 'optional', type: 'text' },
        { id: 'qwen3-30b-a3b', imagePolicy: 'forbidden', type: 'text' },
        { id: 'claude-3-5-haiku-20241022', imagePolicy: 'forbidden', type: 'text' },
        { id: 'olmo-3.1-32b-instruct', imagePolicy: 'forbidden', type: 'text' },
        { id: 'ring-flash-2.0', imagePolicy: 'forbidden', type: 'text' },
        { id: 'llama-3.3-70b-instruct', imagePolicy: 'forbidden', type: 'text' },
        { id: 'gemma-3n-e4b-it', imagePolicy: 'forbidden', type: 'text' },
        { id: 'gpt-oss-20b', imagePolicy: 'forbidden', type: 'text' },
        { id: 'nvidia-nemotron-3-nano-30b-a3b-bf16', imagePolicy: 'forbidden', type: 'text' },
        { id: 'mercury', imagePolicy: 'forbidden', type: 'text' },
        { id: 'magistral-medium-2506', imagePolicy: 'forbidden', type: 'text' },
        { id: 'olmo-3-32b-think', imagePolicy: 'forbidden', type: 'text' },
        { id: 'mistral-small-3.1-24b-instruct-2503', imagePolicy: 'optional', type: 'text' },
        { id: 'ibm-granite-h-small', imagePolicy: 'forbidden', type: 'text' },
        { id: 'olmo-3.1-32b-think', imagePolicy: 'forbidden', type: 'text' },
        { id: 'qwen3-vl-8b-thinking', imagePolicy: 'optional', type: 'text' },
        { id: 'qwen3-vl-8b-instruct', imagePolicy: 'optional', type: 'text' },
        { id: 'grok-4-1-fast-non-reasoning', imagePolicy: 'forbidden', type: 'text' },
        { id: 'amazon.nova-pro-v1:0', imagePolicy: 'optional', type: 'text' },
        { id: 'gemini-3-flash-thinking-minimal', codeName: 'gemini-3-flash (thinking-minimal)', imagePolicy: 'forbidden', type: 'text' },
        { id: 'amazon-nova-experimental-chat-12-10', imagePolicy: 'forbidden', type: 'text' },
        { id: 'ernie-5.0-preview-1220', imagePolicy: 'forbidden', type: 'text' },
        { id: 'qwen3-max-2025-09-26', imagePolicy: 'forbidden', type: 'text' },
        { id: 'glm-4.6v-flash', imagePolicy: 'optional', type: 'text' },
        { id: 'MiMo-7B', imagePolicy: 'forbidden', type: 'text' },
        { id: 'qwen3-omni-flash', imagePolicy: 'forbidden', type: 'text' },
        { id: 'qwen-vl-max-2025-08-13', imagePolicy: 'optional', type: 'text' },
        { id: 'minimax-m2-preview', imagePolicy: 'forbidden', type: 'text' },
        { id: 'gpt-5-high-new-system-prompt', imagePolicy: 'optional', type: 'text' },
        { id: 'MiMo-VL-7B-RL-2508', imagePolicy: 'optional', type: 'text' },

        // --- 搜索模型 ---
        { id: 'gemini-3-pro-grounding', imagePolicy: 'forbidden', type: 'text', search: true },
        { id: 'gpt-5.2-search', imagePolicy: 'forbidden', type: 'text', search: true },
        { id: 'gpt-5.1-search', imagePolicy: 'forbidden', type: 'text', search: true },
        { id: 'grok-4-1-fast-search', imagePolicy: 'forbidden', type: 'text', search: true },
        { id: 'grok-4-fast-search', imagePolicy: 'forbidden', type: 'text', search: true },
        { id: 'gemini-2.5-pro-grounding', imagePolicy: 'forbidden', type: 'text', search: true },
        { id: 'o3-search', imagePolicy: 'forbidden', type: 'text', search: true },
        { id: 'ppl-sonar-reasoning-pro-high', imagePolicy: 'forbidden', type: 'text', search: true },
        { id: 'grok-4-search', imagePolicy: 'forbidden', type: 'text', search: true },
        { id: 'claude-opus-4-1-search', imagePolicy: 'forbidden', type: 'text', search: true },
        { id: 'gpt-5-search', imagePolicy: 'forbidden', type: 'text', search: true },
        { id: 'claude-opus-4-search', imagePolicy: 'forbidden', type: 'text', search: true },
        { id: 'diffbot-small-xl', imagePolicy: 'forbidden', type: 'text', search: true },
        { id: 'gpt-5.2-search-non-reasoning', imagePolicy: 'forbidden', type: 'text', search: true },
        { id: 'claude-opus-4-5-search', imagePolicy: 'forbidden', type: 'text', search: true },
        { id: 'claude-sonnet-4-5-search', imagePolicy: 'forbidden', type: 'text', search: true },
        { id: 'gpt-5.1-search-sp', imagePolicy: 'forbidden', type: 'text', search: true },
        { id: 'gemini-3-flash-grounding', imagePolicy: 'forbidden', type: 'text', search: true }
    ],

    // 无需导航处理器
    navigationHandlers: [],

    // 核心生图方法
    generate
};
