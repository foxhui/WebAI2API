/**
 * @fileoverview Google Gemini 图片、视频生成适配器
 */

import {
    sleep,
    safeClick,
    uploadFilesViaChooser
} from '../engine/utils.js';
import {
    fillPrompt,
    normalizePageError,
    normalizeHttpError,
    moveMouseAway,
    waitForInput,
    gotoWithCheck,
    waitApiResponse,
    useContextDownload
} from '../utils/index.js';
import { logger } from '../../utils/logger.js';

// --- 配置常量 ---
const TARGET_URL = 'https://gemini.google.com/app?hl=en';


/**
 * 执行生图任务
 * @param {object} context - 浏览器上下文 { page, config }
 * @param {string} prompt - 提示词
 * @param {string[]} imgPaths - 图片路径数组
 * @param {string} [modelId] - 模型 ID (此适配器未使用)
 * @param {object} [meta={}] - 日志元数据
 * @returns {Promise<{image?: string, error?: string}>}
 */
async function generate(context, prompt, imgPaths, modelId, meta = {}) {
    const { page } = context;
    const inputLocator = page.getByRole('textbox');
    const sendBtnLocator = page.getByRole('button', { name: 'Send message' });

    try {
        logger.info('适配器', '开启新会话...', meta);
        await gotoWithCheck(page, TARGET_URL);

        // 1. 等待输入框加载
        await waitForInput(page, inputLocator, { click: false });
        await sleep(1500, 2500);

        // 2. 上传图片 (使用 filechooser 事件，因为 Firefox 不会创建 DOM input 元素)
        if (imgPaths && imgPaths.length > 0) {
            // 点击加号按钮打开菜单
            logger.debug('适配器', '点击加号按钮...', meta);
            const uploadMenuBtn = page.getByRole('button', { name: 'Open upload file menu' });
            await safeClick(page, uploadMenuBtn, { bias: 'button' });
            await sleep(500, 1000);

            // 使用公共函数上传文件
            const uploadFilesBtn = page.getByRole('button', { name: /Upload files/ });
            await uploadFilesViaChooser(page, uploadFilesBtn, imgPaths, {
                uploadValidator: (response) => {
                    const url = response.url();
                    return response.status() === 200 &&
                        url.includes('google.com/upload/') &&
                        url.includes('upload_id=');
                }
            });

            await sleep(1000, 2000);
        }

        // 3. 填写提示词
        await safeClick(page, inputLocator, { bias: 'input' });
        await fillPrompt(page, inputLocator, prompt, meta);
        await sleep(500, 1000);

        // 4. 点击 Tools 按钮启用图片/视频生成
        logger.debug('适配器', '点击 Tools 按钮...', meta);
        const toolsBtn = page.getByRole('button', { name: 'Tools' });
        await safeClick(page, toolsBtn, { bias: 'button' });
        await sleep(500, 1000);

        // 检测是否是视频模型
        const isVideoModel = modelId && modelId.startsWith('veo-');

        // 5. 点击 Create images / Create videos 按钮
        if (isVideoModel) {
            logger.debug('适配器', '点击 Create videos 按钮...', meta);
            const createVideosBtn = page.getByRole('button', { name: /^Create videos/ });

            // 检查按钮是否存在（有些账号可能没有视频生成功能）
            const btnCount = await createVideosBtn.count();
            if (btnCount === 0) {
                logger.error('适配器', '未找到 Create videos 按钮，该账号可能不支持视频生成', meta);
                return { error: '该账号不支持视频生成功能 (未找到 Create videos 按钮)' };
            }

            await safeClick(page, createVideosBtn, { bias: 'button' });
        } else {
            logger.debug('适配器', '点击 Create images 按钮...', meta);
            const createImagesBtn = page.getByRole('button', { name: 'Create images' });
            await safeClick(page, createImagesBtn, { bias: 'button' });
        }
        await sleep(500, 1000);

        // 6. 点击发送
        logger.debug('适配器', '点击发送...', meta);
        await safeClick(page, sendBtnLocator, { bias: 'button' });

        logger.info('适配器', '等待生成结果...', meta);

        // 7. 等待 StreamGenerate API
        let streamApiResponse;
        try {
            streamApiResponse = await waitApiResponse(page, {
                urlMatch: 'assistant.lamda.BardFrontendService/StreamGenerate',
                method: 'POST',
                timeout: 120000,
                meta
            });
        } catch (e) {
            const pageError = normalizePageError(e, meta);
            if (pageError) return pageError;
            throw e;
        }

        // 检查 HTTP 错误
        const httpError = normalizeHttpError(streamApiResponse);
        if (httpError) {
            logger.error('适配器', `API 返回错误: ${httpError.error}`, meta);
            return { error: `API 返回错误: ${httpError.error}` };
        }

        // 8. 等待图片/视频响应
        if (isVideoModel) {
            // 视频模式：等待视频下载链接
            logger.info('适配器', '生成请求成功，等待视频...', meta);

            let videoResponse;
            try {
                videoResponse = await waitApiResponse(page, {
                    urlMatch: 'contribution.usercontent.google.com/download',
                    urlContains: 'filename=video.mp4',
                    method: 'GET',
                    timeout: 180000,  // 视频生成可能更慢
                    meta
                });
            } catch (e) {
                const pageError = normalizePageError(e, meta);
                if (pageError) return pageError;
                throw e;
            }

            // 获取视频数据
            const buffer = await videoResponse.body();
            const base64 = buffer.toString('base64');
            const contentType = videoResponse.headers()['content-type'] || 'video/mp4';
            const videoData = `data:${contentType};base64,${base64}`;

            logger.info('适配器', '已获取视频，任务完成', meta);
            return { image: videoData };

        } else {
            // 图片模式：直接从 StreamGenerate 响应体解析图片 URL
            logger.info('适配器', '生成请求成功，正在解析响应...', meta);

            // 解析响应体，提取图片 URL
            const bodyBuffer = await streamApiResponse.body();
            const imageUrls = extractImageUrlsFromResponse(bodyBuffer);

            if (imageUrls.length === 0) {
                // 没有找到图片 URL，尝试提取文本作为错误信息
                const errorText = extractAiTextFromResponse(bodyBuffer);
                const errorMsg = errorText.substring(0, 150) || '生成失败，响应中未包含图片';
                logger.error('适配器', `未找到图片: ${errorMsg}`, meta);
                return { error: errorMsg };
            }

            // 取第一张图片，追加 =s1024-rj 获取高分辨率
            const imageUrl = imageUrls[0] + '=s1024-rj';
            logger.info('适配器', `找到 ${imageUrls.length} 张图片，开始下载...`, meta);

            // 使用封装的下载函数
            const result = await useContextDownload(imageUrl, page);
            if (result.error) {
                logger.error('适配器', result.error, meta);
                return result;
            }

            logger.info('适配器', '已获取图片，任务完成', meta);
            return result;
        }

    } catch (err) {
        // 顶层错误处理
        const pageError = normalizePageError(err, meta);
        if (pageError) return pageError;

        logger.error('适配器', '生成任务失败', { ...meta, error: err.message });
        return { error: `生成任务失败: ${err.message}` };
    } finally {
        // 任务结束，将鼠标移至安全区域
        await moveMouseAway(page);
    }
}

/**
 * 适配器 manifest
 */
export const manifest = {
    id: 'gemini',
    displayName: 'Google Gemini (图片、视频生成)',
    description: '使用 Google Gemini 官网生成图片和视频，支持参考图片上传。需要已登录的 Google 账户，免费账户图片生成有速率限制，视频生成必须为会员账户才可使用。',

    // 入口 URL
    getTargetUrl(config, workerConfig) {
        return TARGET_URL;
    },

    // 模型列表
    models: [
        { id: 'gemini-3-pro-image-preview', imagePolicy: 'optional' },
        { id: 'veo-3.1-generate-preview', imagePolicy: 'optional' }
    ],

    // 无需导航处理器
    navigationHandlers: [],

    // 核心生图方法
    generate
};

// ==========================================
// 解析 gRPC Batchexecute 响应
// ==========================================

/**
 * 解析 batchexecute/batch RPC 响应（直接操作 Buffer）
 * @param {Buffer} buf - 响应体 Buffer
 */
function parseLenFramedResponse(buf) {
    let i = 0;

    // 去掉 )]}' 这种 XSSI 前缀（通常是第一行）
    if (buf.length >= 4 && buf[0] === 0x29 && buf[1] === 0x5d && buf[2] === 0x7d) {
        const firstNl = buf.indexOf(0x0a);
        if (firstNl !== -1) i = firstNl + 1;
    }

    const frames = [];

    const readLineBuf = () => {
        if (i >= buf.length) return null;
        const nl = buf.indexOf(0x0a, i);
        let line;
        if (nl === -1) {
            line = buf.slice(i);
            i = buf.length;
        } else {
            line = buf.slice(i, nl);
            i = nl + 1;
        }
        if (line.length && line[line.length - 1] === 0x0d) line = line.slice(0, -1);
        return line;
    };

    let pendingLen = null;

    while (true) {
        const lineBuf = readLineBuf();
        if (lineBuf === null) break;

        const lineStr = lineBuf.toString('utf8').trim();
        if (!lineStr) continue;

        if (pendingLen === null) {
            if (/^\d+$/.test(lineStr)) pendingLen = Number(lineStr);
            continue;
        }

        let chunkBuf = lineBuf;
        let chunkStr = chunkBuf.toString('utf8').trim();

        while (true) {
            try {
                frames.push(JSON.parse(chunkStr));
                break;
            } catch (e) {
                const msg = String(e && e.message || '');
                const looksTruncated = /Unexpected end of JSON input|Unterminated string/.test(msg);

                if (!looksTruncated) break;

                const savedPos = i;
                const next = readLineBuf();
                if (next === null) break;

                const nextStr = next.toString('utf8').trim();
                if (/^\d+$/.test(nextStr)) {
                    i = savedPos;
                    break;
                }

                chunkBuf = Buffer.concat([chunkBuf, Buffer.from('\n'), next]);
                chunkStr = chunkBuf.toString('utf8').trim();
            }
        }

        pendingLen = null;
    }

    return frames;
}

/**
 * 把 frame 里的 payload 再 parse 一次
 */
function extractPayloads(frames) {
    const payloads = [];
    for (const frame of frames) {
        if (!Array.isArray(frame)) continue;

        for (const item of frame) {
            if (!Array.isArray(item)) continue;
            const payloadStr = item[2];
            if (typeof payloadStr !== 'string') continue;

            try {
                payloads.push(JSON.parse(payloadStr));
            } catch {
                // ignore
            }
        }
    }
    return payloads;
}

/**
 * 深度遍历，查找 googleusercontent.com/gg-dl 开头的图片 URL
 * @param {any} root - 要遍历的对象
 * @returns {string[]} 图片 URL 数组
 */
function collectImageUrlsDeep(root) {
    const urls = [];
    const stack = [root];

    while (stack.length) {
        const cur = stack.pop();
        if (!cur) continue;

        if (typeof cur === 'string') {
            // 匹配 googleusercontent.com/gg-dl 图片 URL
            if (cur.includes('googleusercontent.com/gg-dl')) {
                urls.push(cur);
            }
        } else if (Array.isArray(cur)) {
            for (const v of cur) stack.push(v);
        } else if (typeof cur === 'object') {
            for (const v of Object.values(cur)) stack.push(v);
        }
    }

    return urls;
}

/**
 * 深度遍历，查找 rc_ 开头的文本内容
 */
function collectRcTextsDeep(root) {
    const bestByRc = new Map();
    const stack = [root];

    while (stack.length) {
        const cur = stack.pop();
        if (!cur) continue;

        if (Array.isArray(cur)) {
            const maybeRc = cur[0];
            const maybeArr = cur[1];
            if (typeof maybeRc === 'string' && maybeRc.startsWith('rc_') && Array.isArray(maybeArr)) {
                const text = maybeArr.filter(v => typeof v === 'string').join('');
                if (text) {
                    const prev = bestByRc.get(maybeRc) || '';
                    if (text.length >= prev.length) bestByRc.set(maybeRc, text);
                }
            }
            for (const v of cur) stack.push(v);
        } else if (typeof cur === 'object') {
            for (const v of Object.values(cur)) stack.push(v);
        }
    }

    return bestByRc;
}

/**
 * 从响应体 Buffer 中提取图片 URL
 * @param {Buffer} bodyBuffer - 响应体 Buffer
 * @returns {string[]} 图片 URL 数组
 */
function extractImageUrlsFromResponse(bodyBuffer) {
    const frames = parseLenFramedResponse(bodyBuffer);
    const payloads = extractPayloads(frames);

    const allUrls = [];
    for (const payload of payloads) {
        const urls = collectImageUrlsDeep(payload);
        allUrls.push(...urls);
    }

    // 去重
    return [...new Set(allUrls)];
}

/**
 * 从响应体 Buffer 中提取 AI 文本（用于错误提示）
 * @param {Buffer} bodyBuffer - 响应体 Buffer
 * @returns {string}
 */
function extractAiTextFromResponse(bodyBuffer) {
    const frames = parseLenFramedResponse(bodyBuffer);
    const payloads = extractPayloads(frames);

    let best = '';
    for (const payload of payloads) {
        const m = collectRcTextsDeep(payload);
        for (const text of m.values()) {
            if (text.length > best.length) best = text;
        }
    }
    return best;
}