/**
 * @fileoverview 豆包 (Doubao) 文本生成适配器
 */

import {
    sleep,
    humanType,
    safeClick,
    uploadFilesViaChooser
} from '../engine/utils.js';
import {
    normalizePageError,
    waitForInput,
    gotoWithCheck
} from '../utils/index.js';
import { logger } from '../../utils/logger.js';

// --- 配置常量 ---
const TARGET_URL = 'https://www.doubao.com/chat/';

/**
 * 执行文本生成任务
 * @param {object} context - 浏览器上下文 { page, config }
 * @param {string} prompt - 提示词
 * @param {string[]} imgPaths - 图片路径数组
 * @param {string} [modelId] - 模型 ID
 * @param {object} [meta={}] - 日志元数据
 * @returns {Promise<{text?: string, reasoning?: string, error?: string}>}
 */
async function generate(context, prompt, imgPaths, modelId, meta = {}) {
    const { page } = context;

    // 是否使用深度思考模式
    const useThinking = modelId === 'seed-thinking' || modelId === 'seed-pro';

    // 模型 ID 到菜单项无障碍名称的映射
    const MODEL_MENU_MAP = {
        'seed': 'Fast Solves most questions',
        'seed-thinking': 'Think Solves more complex problems',
        'seed-pro': 'Pro Advanced Pro model'
    };

    try {
        logger.info('适配器', '开启新会话...', meta);
        await gotoWithCheck(page, TARGET_URL);

        // 1. 等待输入框加载
        const inputLocator = page.locator('textarea[data-testid="chat_input_input"]');
        await waitForInput(page, inputLocator, { click: false });

        // 2. 上传图片 (如果有)
        if (imgPaths && imgPaths.length > 0) {
            logger.info('适配器', `开始上传 ${imgPaths.length} 张图片...`, meta);

            // 预先拦截 ApplyImageUpload 响应，动态收集实际上传路径
            const expectedUploadPaths = new Set();
            const applyUploadHandler = async (response) => {
                try {
                    const url = response.url();
                    if (!url.includes('Action=ApplyImageUpload') || response.status() !== 200) return;
                    const json = await response.json();
                    const storeUri = json.Result?.UploadAddress?.StoreInfos?.[0]?.StoreUri;
                    if (storeUri) {
                        expectedUploadPaths.add(storeUri);
                        logger.debug('适配器', `已获取上传路径: ${storeUri}`, meta);
                    }
                } catch { /* 忽略解析错误 */ }
            };
            page.on('response', applyUploadHandler);

            try {
                // 点击上传菜单按钮
                const uploadMenuBtn = page.locator('main button[aria-haspopup="menu"]:not(:has(div[data-testid="deep-thinking-action-button"]))').first();
                await safeClick(page, uploadMenuBtn, { bias: 'button' });
                await sleep(300, 500);

                // 点击上传文件选项
                const uploadItem = page.locator('div[data-testid="upload_file_panel_upload_item"][role="menuitem"]');
                await uploadFilesViaChooser(page, uploadItem, imgPaths, {
                    uploadValidator: (response) => {
                        if (response.status() !== 200 || response.request().method() !== 'POST') return false;
                        const url = response.url();
                        for (const path of expectedUploadPaths) {
                            if (url.includes(path)) return true;
                        }
                        return false;
                    }
                }, meta);
            } finally {
                page.off('response', applyUploadHandler);
            }

            logger.info('适配器', '图片上传完成', meta);
        }

        // 3. 选择模型
        const modelMenuName = MODEL_MENU_MAP[modelId] || MODEL_MENU_MAP['seed'];
        logger.debug('适配器', `选择模型: ${modelId} -> ${modelMenuName}`, meta);

        const modelSelectorBtn = page.locator('main button[aria-haspopup="menu"]:has(div[data-testid="deep-thinking-action-button"])');
        const selectorExists = await modelSelectorBtn.count() > 0;

        if (selectorExists) {
            await safeClick(page, modelSelectorBtn, { bias: 'button' });
            await sleep(300, 500);

            const menuItem = page.getByRole('menuitem', { name: modelMenuName });
            await menuItem.waitFor({ state: 'visible', timeout: 5000 });
            await safeClick(page, menuItem, { bias: 'button' });
            await sleep(200, 400);
        }

        // 4. 填写提示词
        await safeClick(page, inputLocator, { bias: 'input' });
        await humanType(page, inputLocator, prompt);

        // 5. 设置 SSE 监听
        logger.debug('适配器', '启动 SSE 监听...', meta);

        let resultText = '';
        let reasoningText = '';
        let isResolved = false;

        const resultPromise = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                if (!isResolved) {
                    isResolved = true;
                    reject(new Error('API_TIMEOUT: 响应超时 (120秒)'));
                }
            }, 120000);

            // 监听页面响应
            const handleResponse = async (response) => {
                try {
                    const url = response.url();
                    // 只处理 chat/completion 接口的 SSE 响应
                    if (!url.includes('chat/completion')) return;

                    const contentType = response.headers()['content-type'] || '';
                    if (!contentType.includes('text/event-stream')) return;

                    // 读取响应体并解析 SSE
                    const body = await response.text();
                    const result = parseSSEResponse(body, useThinking);

                    if (result.text) {
                        resultText = result.text;
                        reasoningText = result.reasoning || '';

                        if (!isResolved) {
                            isResolved = true;
                            clearTimeout(timeout);
                            page.off('response', handleResponse);
                            resolve();
                        }
                    }
                } catch (e) {
                    // 忽略解析错误，继续等待
                }
            };

            page.on('response', handleResponse);
        });

        // 6. 点击发送
        const sendBtn = page.locator('button[data-testid="chat_input_send_button"]');
        await sendBtn.waitFor({ state: 'visible', timeout: 10000 });
        logger.info('适配器', '点击发送...', meta);
        await safeClick(page, sendBtn, { bias: 'button' });

        // 7. 等待响应
        logger.info('适配器', '等待生成结果...', meta);
        await resultPromise;

        if (resultText) {
            logger.info('适配器', `生成完成，文本长度: ${resultText.length}`, meta);
            const result = { text: resultText };
            if (reasoningText) {
                result.reasoning = reasoningText;
            }
            return result;
        } else {
            return { error: '未能从响应中提取文本' };
        }

    } catch (err) {
        const pageError = normalizePageError(err, meta);
        if (pageError) return pageError;

        logger.error('适配器', '生成任务失败', { ...meta, error: err.message });
        return { error: `生成任务失败: ${err.message}` };
    } finally { }
}

/**
 * 解析 SSE 响应体，提取最终文本
 * @param {string} body - SSE 响应体
 * @param {boolean} useThinking - 是否使用深度思考模式
 * @returns {{text: string, reasoning?: string}}
 */
function parseSSEResponse(body, useThinking) {
    let resultText = '';
    let reasoningText = '';

    try {
        const lines = body.split('\n');
        let inThinkingBlock = false;
        let thinkingBlockId = null;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();

            // 解析事件类型
            if (line.startsWith('event:')) {
                const eventType = line.substring(6).trim();

                // 找到对应的 data 行
                if (i + 1 < lines.length && lines[i + 1].startsWith('data:')) {
                    const dataLine = lines[i + 1].substring(5).trim();
                    if (!dataLine || dataLine === '{}') continue;

                    try {
                        const data = JSON.parse(dataLine);

                        // SSE_REPLY_END with end_type: 1 包含完整回复
                        if (eventType === 'SSE_REPLY_END' && data.end_type === 1) {
                            resultText = data.msg_finish_attr?.brief || '';
                        }

                        // STREAM_MSG_NOTIFY 检测深度思考块
                        if (eventType === 'STREAM_MSG_NOTIFY' && useThinking) {
                            try {
                                const blocks = data.content?.content_block || [];
                                for (const block of blocks) {
                                    if (block.block_type === 10040 && block.content?.thinking_block) {
                                        inThinkingBlock = true;
                                        thinkingBlockId = block.block_id;
                                    }
                                }
                            } catch { /* 忽略 thinking 块检测错误 */ }
                        }

                        // STREAM_CHUNK 处理内容块
                        if (eventType === 'STREAM_CHUNK' && useThinking && data.patch_op) {
                            try {
                                for (const op of data.patch_op) {
                                    if (op.patch_object === 1 && op.patch_value?.content_block) {
                                        for (const block of op.patch_value.content_block) {
                                            // 如果有 parent_id 指向 thinking_block，则是思考内容
                                            if (block.parent_id === thinkingBlockId) {
                                                const text = block.content?.text_block?.text || '';
                                                if (text) reasoningText += text;
                                            }
                                            // 思考块结束标记
                                            if (block.block_type === 10040 && block.is_finish) {
                                                inThinkingBlock = false;
                                            }
                                        }
                                    }
                                }
                            } catch { /* 忽略 thinking 内容提取错误 */ }
                        }

                        // CHUNK_DELTA 增量文本 (思考过程中的增量)
                        if (eventType === 'CHUNK_DELTA' && useThinking && inThinkingBlock) {
                            try {
                                const text = data.text || '';
                                if (text) reasoningText += text;
                            } catch { /* 忽略增量文本提取错误 */ }
                        }

                    } catch {
                        // JSON 解析失败，跳过
                    }
                }
            }
        }
    } catch {
        // 整体解析失败，返回空结果
    }

    return { text: resultText, reasoning: reasoningText };
}

/**
 * 适配器 manifest
 */
export const manifest = {
    id: 'doubao_text',
    displayName: '豆包 (文本生成)',
    description: '使用字节跳动豆包生成文本，支持深度思考模式和图片上传。需要已登录的豆包账户。',

    getTargetUrl(config, workerConfig) {
        return TARGET_URL;
    },

    models: [
        { id: 'seed', imagePolicy: 'optional', type: 'text' },
        { id: 'seed-thinking', imagePolicy: 'optional', type: 'text' },
        { id: 'seed-pro', imagePolicy: 'optional', type: 'text' }
    ],

    navigationHandlers: [],

    generate
};
