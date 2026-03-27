/**
 * @fileoverview 豆包 (Doubao) 图片生成适配器
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
    gotoWithCheck,
    useContextDownload
} from '../utils/index.js';
import { logger } from '../../utils/logger.js';

// --- 配置常量 ---
const TARGET_URL = 'https://www.doubao.com/chat/';

/**
 * 执行图片生成任务
 * @param {object} context - 浏览器上下文 { page, config }
 * @param {string} prompt - 提示词
 * @param {string[]} imgPaths - 图片路径数组
 * @param {string} [modelId] - 模型 ID
 * @param {object} [meta={}] - 日志元数据
 * @returns {Promise<{image?: string, error?: string}>}
 */
async function generate(context, prompt, imgPaths, modelId, meta = {}) {
    const { page, config } = context;

    // 获取模型配置
    const modelConfig = manifest.models.find(m => m.id === modelId) || manifest.models[0];
    const { codeName } = modelConfig;

    try {
        logger.info('适配器', '开启新会话...', meta);
        await gotoWithCheck(page, TARGET_URL);

        // 1. 点击进入图片生成模式
        logger.debug('适配器', '进入图片生成模式...', meta);
        const skillBtn = page.locator('button[data-testid="skill_bar_button_3"]');
        await skillBtn.waitFor({ state: 'visible', timeout: 30000 });
        await safeClick(page, skillBtn, { bias: 'button' });

        // 2. 选择模型
        logger.debug('适配器', `选择模型: ${codeName}...`, meta);
        const modelBtn = page.locator('button[data-testid="image-creation-chat-input-picture-model-button"]');
        await modelBtn.waitFor({ state: 'visible', timeout: 10000 });
        await safeClick(page, modelBtn, { bias: 'button' });
        await sleep(300, 500);

        const modelOption = page.getByRole('menuitem', { name: codeName });
        await modelOption.waitFor({ state: 'visible', timeout: 5000 });
        await safeClick(page, modelOption, { bias: 'button' });

        // 3. 上传参考图片 (如果有)
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
                const uploadBtn = page.locator('button[data-testid="image-creation-chat-input-picture-reference-button"]');
                await uploadBtn.waitFor({ state: 'visible', timeout: 10000 });

                await uploadFilesViaChooser(page, uploadBtn, imgPaths, {
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

        // 4. 填写提示词
        const inputLocator = page.locator('div[data-testid="chat_input_input"][role="textbox"]');
        await waitForInput(page, inputLocator, { click: true });
        await humanType(page, inputLocator, prompt);

        // 5. 设置 SSE 监听
        logger.debug('适配器', '启动 SSE 监听...', meta);

        let imageUrl = null;
        let isResolved = false;

        const resultPromise = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                if (!isResolved) {
                    isResolved = true;
                    reject(new Error('API_TIMEOUT: 响应超时 (180秒)'));
                }
            }, 180000);

            const handleResponse = async (response) => {
                try {
                    const url = response.url();
                    if (!url.includes('chat/completion')) return;

                    const contentType = response.headers()['content-type'] || '';
                    if (!contentType.includes('text/event-stream')) return;

                    const body = await response.text();
                    const extractedUrl = parseSSEForImage(body);

                    if (extractedUrl) {
                        imageUrl = extractedUrl;
                        if (!isResolved) {
                            isResolved = true;
                            clearTimeout(timeout);
                            page.off('response', handleResponse);
                            resolve();
                        }
                    }
                } catch (e) {
                    // 忽略解析错误
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
        logger.info('适配器', '等待图片生成...', meta);
        await resultPromise;

        if (!imageUrl) {
            return { error: '未能从响应中提取图片链接' };
        }

        logger.info('适配器', '已获取图片链接，开始下载...', meta);
        logger.debug('适配器', `图片 URL: ${imageUrl}`, meta);

        // 8. 下载图片
        const imgDlCfg = config?.backend?.pool?.failover || {};
        const downloadResult = await useContextDownload(imageUrl, page, {
            retries: imgDlCfg.imgDlRetry ? (imgDlCfg.imgDlRetryMaxRetries || 2) : 0
        });
        if (downloadResult.error) {
            logger.error('适配器', downloadResult.error, meta);
            return downloadResult;
        }

        logger.info('适配器', '图片生成完成', meta);
        return { image: downloadResult.image, imageUrl: downloadResult.imageUrl };

    } catch (err) {
        const pageError = normalizePageError(err, meta);
        if (pageError) return pageError;

        logger.error('适配器', '生成任务失败', { ...meta, error: err.message });
        return { error: `生成任务失败: ${err.message}` };
    } finally { }
}

/**
 * 解析 SSE 响应，提取图片链接
 * @param {string} body - SSE 响应体
 * @returns {string|null} 图片 URL
 */
function parseSSEForImage(body) {
    const lines = body.split('\n');

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        if (line.startsWith('data:')) {
            const dataLine = line.substring(5).trim();
            if (!dataLine || dataLine === '{}') continue;

            try {
                const data = JSON.parse(dataLine);
                const url = extractRawImage(data);
                if (url) return url;
            } catch (e) {
                // JSON 解析失败，跳过
            }
        }
    }

    return null;
}

/**
 * 从 SSE 消息数据中提取原图 Raw 链接
 * @param {Object} sseData - 解析后的 data JSON 对象
 * @returns {string|null} - 返回图片 URL 或 null
 */
function extractRawImage(sseData) {
    if (!sseData || !sseData.patch_op || !Array.isArray(sseData.patch_op)) {
        return null;
    }

    for (const op of sseData.patch_op) {
        const contentBlocks = op.patch_value?.content_block;

        if (Array.isArray(contentBlocks)) {
            for (const block of contentBlocks) {
                // block_type 2074 代表生成卡片
                if (block.block_type === 2074) {
                    const creations = block.content?.creation_block?.creations;

                    if (Array.isArray(creations)) {
                        for (const creation of creations) {
                            // 提取 image_ori_raw，只有图片生成完成时才会出现
                            const rawUrl = creation.image?.image_ori_raw?.url;
                            if (rawUrl) {
                                return rawUrl;
                            }
                        }
                    }
                }
            }
        }
    }

    return null;
}

/**
 * 适配器 manifest
 */
export const manifest = {
    id: 'doubao',
    displayName: '豆包 (图片生成)',
    description: '使用字节跳动豆包生成图片，支持多种模型和参考图片上传。需要已登录的豆包账户。',

    getTargetUrl(config, workerConfig) {
        return TARGET_URL;
    },

    models: [
        { id: 'seedream-4.5', codeName: 'Seedream 4.5', imagePolicy: 'optional' },
        { id: 'seedream-4.0', codeName: 'Seedream 4.0', imagePolicy: 'optional' },
        { id: 'seedream-3.0', codeName: 'Seedream 3.0', imagePolicy: 'optional' }
    ],

    navigationHandlers: [],

    generate
};
