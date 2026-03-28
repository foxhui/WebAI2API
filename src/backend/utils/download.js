/**
 * @fileoverview 资源下载模块
 * @description 图片下载与 Base64 转换
 */

import { logger } from '../../utils/logger.js';

/**
 * 判断错误是否可重试
 * @param {string} message - 错误消息
 * @returns {boolean}
 */
function isRetryableError(message) {
    return /timeout|network|econnreset|econnrefused|etimedout|disconnected|tls|socket/i.test(message);
}

/**
 * 使用页面上下文下载图片并转换为 Base64
 * 自动继承页面的 Cookie 和 Session，解决鉴权问题
 * @param {string} url - 图片 URL
 * @param {import('playwright-core').Page} page - Playwright 页面对象
 * @param {object} [options] - 可选配置
 * @param {number} [options.timeout=60000] - 超时时间（毫秒）
 * @param {number} [options.retries=3] - 最大重试次数
 * @param {number} [options.retryDelay=1000] - 重试延迟基数（毫秒）
 * @returns {Promise<{ image?: string, imageUrl?: string, error?: string }>} 下载结果（包含原始 URL）
 */
export async function useContextDownload(url, page, options = {}) {
    const { timeout = 120000, retries = 3, retryDelay = 1000 } = options;
    // 至少执行一次尝试（retries=0 表示不重试，但仍需下载一次）
    const maxAttempts = Math.max(1, retries);

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const response = await page.request.get(url, { timeout });

            if (!response.ok()) {
                const status = response.status();
                // 5xx 错误可重试
                if (status >= 500 && attempt < maxAttempts) {
                    logger.warn('下载', `HTTP ${status}，重试 ${attempt}/${maxAttempts}...`);
                    await new Promise(r => setTimeout(r, retryDelay * attempt));
                    continue;
                }
                return { error: `下载失败: HTTP ${status}`, imageUrl: url };
            }

            const buffer = await response.body();
            const base64 = buffer.toString('base64');
            const contentType = response.headers()['content-type'] || 'image/png';
            const mimeType = contentType.split(';')[0].trim();

            return { image: `data:${mimeType};base64,${base64}`, imageUrl: url };
        } catch (e) {
            if (isRetryableError(e.message) && attempt < maxAttempts) {
                logger.warn('下载', `${e.message}，重试 ${attempt}/${maxAttempts}...`);
                await new Promise(r => setTimeout(r, retryDelay * attempt));
                continue;
            }
            return { error: `已获取结果，但图片下载时遇到错误: ${e.message}`, imageUrl: url };
        }
    }

    return { error: '下载失败: 已达最大重试次数', imageUrl: url };
}
