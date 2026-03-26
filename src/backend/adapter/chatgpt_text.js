/**
 * @fileoverview ChatGPT 文本生成适配器
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
import { withUILock } from '../utils/uiLock.js';
import { logger } from '../../utils/logger.js';

// --- 配置常量 ---
const TARGET_URL = 'https://chatgpt.com/';
const INPUT_SELECTOR = '.ProseMirror';

/**
 * 通过 UI 选择模型
 * @param {import('playwright-core').Page} page - 页面对象
 * @param {string} codeName - 模型 codeName
 * @param {object} meta - 日志元数据
 * @returns {Promise<boolean>} 是否成功选择了模型
 */
async function selectModel(page, codeName, meta = {}) {
    try {
        // 1. 点击 Model selector 按钮
        const modelSelectorBtn = page.getByRole('button', { name: /^Model selector/ });
        const btnExists = await modelSelectorBtn.count();
        if (btnExists === 0) {
            logger.debug('适配器', '未找到模型选择器按钮，跳过选择模型', meta);
            return false;
        }

        await modelSelectorBtn.waitFor({ timeout: 5000 });
        await safeClick(page, modelSelectorBtn, { bias: 'button' });
        await sleep(300, 500);

        // 2. 检查是否有 Legacy models 选项
        const legacyMenuItem = page.getByRole('menuitem', { name: /^Legacy models/ });
        const legacyExists = await legacyMenuItem.count();
        if (legacyExists > 0) {
            logger.debug('适配器', '发现 Legacy models 选项，正在点击...', meta);
            await safeClick(page, legacyMenuItem, { bias: 'button' });
            await sleep(300, 500);
        }

        // 3. 查找匹配 codeName 开头的 menuitem
        const targetMenuItem = page.getByRole('menuitem', { name: new RegExp(`^${codeName}`) });
        const targetExists = await targetMenuItem.count();
        if (targetExists > 0) {
            logger.info('适配器', `正在选择模型: ${codeName}`, meta);
            await safeClick(page, targetMenuItem, { bias: 'button' });
            return true;
        } else {
            logger.debug('适配器', `未找到模型 ${codeName}，使用默认模型`, meta);
            // 点击空白区域关闭菜单
            await page.keyboard.press('Escape');
            return false;
        }
    } catch (e) {
        logger.warn('适配器', `选择模型失败: ${e.message}`, meta);
        // 尝试关闭菜单
        await page.keyboard.press('Escape').catch(() => { });
        return false;
    }
}

/**
 * 执行文本生成任务
 * @param {object} context - 浏览器上下文 { page, config }
 * @param {string} prompt - 提示词
 * @param {string[]} imgPaths - 图片路径数组
 * @param {string} [modelId] - 模型 ID
 * @param {object} [meta={}] - 日志元数据
 * @returns {Promise<{text?: string, error?: string}>}
 */
async function generate(context, prompt, imgPaths, modelId, meta = {}) {
    const { page, instanceName, config } = context;
    const waitTimeout = config?.backend?.pool?.waitTimeout ?? 120000;
    const sendBtnLocator = page.getByRole('button', { name: 'Send prompt' });

    try {
        // === UI 交互阶段：需要加锁 ===
        await withUILock(instanceName, async () => {
            logger.info('适配器', '开启新会话...', meta);
            await gotoWithCheck(page, TARGET_URL);

            // 1. 等待输入框加载
            await waitForInput(page, INPUT_SELECTOR, { click: false });

            // 2. 选择模型
            const modelConfig = manifest.models.find(m => m.id === modelId);
            const targetModel = modelConfig?.codeName || modelId;
            if (targetModel) {
                await selectModel(page, targetModel, meta);
            }

            // 3. 上传图片 (双击 Add files and more 按钮)
            if (imgPaths && imgPaths.length > 0) {
                logger.info('适配器', `开始上传 ${imgPaths.length} 张图片...`, meta);
                const expectedUploads = imgPaths.length;
                let uploadedCount = 0;
                let processedCount = 0;

                logger.debug('适配器', '双击添加文件按钮...', meta);
                const addFilesBtn = page.getByRole('button', { name: 'Add files and more' });

                await uploadFilesViaChooser(page, addFilesBtn, imgPaths, {
                    clickAction: 'dblclick',  // 使用双击
                    uploadValidator: (response) => {
                        const url = response.url();
                        if (response.status() === 200) {
                            // 上传请求
                            if (url.includes('backend-api/files') && !url.includes('process_upload_stream')) {
                                uploadedCount++;
                                logger.debug('适配器', `图片上传进度: ${uploadedCount}/${expectedUploads}`, meta);
                                return false;
                            }
                            // 处理完成请求
                            if (url.includes('backend-api/files/process_upload_stream')) {
                                processedCount++;
                                logger.info('适配器', `图片处理进度: ${processedCount}/${expectedUploads}`, meta);

                                if (processedCount >= expectedUploads) {
                                    return true;
                                }
                            }
                        }
                        return false;
                    }
                }, meta);
            }

            // 4. 输入提示词
            logger.info('适配器', '输入提示词...', meta);
            await safeClick(page, INPUT_SELECTOR, { bias: 'input' });
            await humanType(page, INPUT_SELECTOR, prompt);

            // 5. 发送提示词（点击后立即释放锁）
            logger.debug('适配器', '发送提示词...', meta);
            await safeClick(page, sendBtnLocator, { bias: 'button' });

            // 锁在这里释放，其他请求可以开始 UI 交互了
        }, meta);
        // === UI 交互阶段结束，锁已释放 ===

        // 6. 等待 API 响应（不需要锁，可以并行）
        logger.info('适配器', '等待生成结果...', meta);

        // 监听 conversation API 的 SSE 流，解析文本内容
        logger.info('适配器', '监听 SSE 流获取文本...', meta);

        let textContent = '';
        let isComplete = false;
        let targetMessageId = null;  // 追踪目标消息 ID

        try {
            await page.waitForResponse(async (response) => {
                const url = response.url();
                if (!url.includes('backend-api/f/conversation')) return false;
                if (response.request().method() !== 'POST') return false;
                if (response.status() !== 200) return false;

                try {
                    const body = await response.text();
                    const lines = body.split('\n');

                    for (const line of lines) {
                        // 跳过空行和事件行
                        if (!line.startsWith('data: ')) continue;

                        const dataStr = line.slice(6).trim();
                        if (dataStr === '[DONE]') {
                            isComplete = true;
                            continue;
                        }

                        try {
                            const data = JSON.parse(dataStr);

                            // 检测目标消息 (assistant 角色, channel: "final", content_type: "text")
                            if (data.v?.message?.author?.role === 'assistant' &&
                                data.v?.message?.channel === 'final' &&
                                data.v?.message?.content?.content_type === 'text') {
                                targetMessageId = data.v.message.id;
                                // 初始内容
                                const parts = data.v.message.content.parts;
                                if (parts && parts[0]) {
                                    textContent = parts[0];
                                }
                            }

                            // 累积 delta 内容 (append 操作)
                            if (data.o === 'append' && data.p === '/message/content/parts/0' && data.v) {
                                textContent += data.v;
                            }

                            // 简单的 delta 追加 (没有 p/o，只有 v)
                            if (data.v && typeof data.v === 'string' && !data.o && !data.p && targetMessageId) {
                                textContent += data.v;
                            }

                            // patch 操作中的 append
                            if (Array.isArray(data.v)) {
                                for (const patch of data.v) {
                                    if (patch.o === 'append' && patch.p === '/message/content/parts/0' && patch.v) {
                                        textContent += patch.v;
                                    }
                                    // 检查是否完成
                                    if (patch.p === '/message/status' && patch.v === 'finished_successfully') {
                                        isComplete = true;
                                    }
                                }
                            }

                            // message_stream_complete 表示完成
                            if (data.type === 'message_stream_complete') {
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
        return { text: textContent.trim() };

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
    id: 'chatgpt_text',
    displayName: 'ChatGPT (文本生成)',
    description: '使用 ChatGPT 官网生成文本，支持多模型切换和图片上传。需要已登录的 ChatGPT 账户，若需要选择模型，请使用会员账号 (包含 K12 教室认证账号)。',

    // 入口 URL
    getTargetUrl(config, workerConfig) {
        return TARGET_URL;
    },

    // 模型列表
    models: [
        { id: 'gpt-5.2', codeName: 'GPT-5.2 Instant', imagePolicy: 'optional' },
        { id: 'gpt-5.2-thinking', codeName: 'GPT-5.2 Thinking', imagePolicy: 'optional' },
        { id: 'gpt-5.1', codeName: 'GPT-5.1 Instant', imagePolicy: 'optional' },
        { id: 'gpt-5.1-thinking', codeName: 'GPT-5.1 Thinking', imagePolicy: 'optional' },
        { id: 'gpt-5', codeName: 'GPT-5 Instant', imagePolicy: 'optional' },
        { id: 'gpt-5-thinking', codeName: 'GPT-5 Thinking', imagePolicy: 'optional' },
    ],

    // 无需导航处理器
    navigationHandlers: [],

    // 核心文本生成方法
    generate
};
