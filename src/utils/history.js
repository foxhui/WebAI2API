/**
 * @fileoverview 请求历史记录管理模块
 * @description 使用 SQLite 存储请求/响应历史，支持媒体文件本地存储
 */

import Database from 'better-sqlite3';
import fs from 'fs/promises';
import path from 'path';
import { logger } from './logger.js';

const DATA_DIR = 'data/history';
const DB_PATH = path.join(DATA_DIR, 'history.db');
const MEDIA_DIR = path.join(DATA_DIR, 'media');

/** @type {Database.Database|null} */
let db = null;

/**
 * 初始化历史记录数据库
 * @returns {Database.Database}
 */
export async function initHistoryDb() {
    if (db) return db;

    // 确保目录存在
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.mkdir(MEDIA_DIR, { recursive: true });

    db = new Database(DB_PATH);

    // 创建表
    db.exec(`
        CREATE TABLE IF NOT EXISTS requests (
            id TEXT PRIMARY KEY,
            created_at INTEGER NOT NULL,
            model_id TEXT,
            model_name TEXT,
            prompt TEXT,
            input_images TEXT,
            response_text TEXT,
            reasoning_content TEXT,
            response_media TEXT,
            status TEXT DEFAULT 'pending',
            error_message TEXT,
            duration_ms INTEGER,
            is_streaming INTEGER DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_created_at ON requests(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_status ON requests(status);
        CREATE INDEX IF NOT EXISTS idx_model_id ON requests(model_id);
    `);

    logger.info('历史记录', '数据库初始化完成');
    return db;
}

/**
 * 获取数据库实例
 * @returns {Database.Database}
 */
function getDb() {
    if (!db) {
        throw new Error('历史记录数据库未初始化，请先调用 initHistoryDb()');
    }
    return db;
}

/**
 * 创建历史记录
 * @param {object} data - 记录数据
 * @returns {string} 记录 ID
 */
export function createRecord(data) {
    const db = getDb();
    const stmt = db.prepare(`
        INSERT INTO requests (id, created_at, model_id, model_name, prompt, input_images, status, is_streaming)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
        data.id,
        Date.now(),
        data.modelId || null,
        data.modelName || null,
        data.prompt || null,
        data.inputImages ? JSON.stringify(data.inputImages) : null,
        data.status || 'pending',
        data.isStreaming ? 1 : 0
    );

    return data.id;
}

/**
 * 更新历史记录
 * @param {string} id - 记录 ID
 * @param {object} updates - 更新数据
 */
export function updateRecord(id, updates) {
    const db = getDb();

    const fields = [];
    const values = [];

    if (updates.status !== undefined) {
        fields.push('status = ?');
        values.push(updates.status);
    }
    if (updates.responseText !== undefined) {
        fields.push('response_text = ?');
        values.push(updates.responseText);
    }
    if (updates.reasoningContent !== undefined) {
        fields.push('reasoning_content = ?');
        values.push(updates.reasoningContent);
    }
    if (updates.responseMedia !== undefined) {
        fields.push('response_media = ?');
        values.push(typeof updates.responseMedia === 'string' ? updates.responseMedia : JSON.stringify(updates.responseMedia));
    }
    if (updates.errorMessage !== undefined) {
        fields.push('error_message = ?');
        values.push(updates.errorMessage);
    }
    if (updates.durationMs !== undefined) {
        fields.push('duration_ms = ?');
        values.push(updates.durationMs);
    }

    if (fields.length === 0) return;

    values.push(id);
    const stmt = db.prepare(`UPDATE requests SET ${fields.join(', ')} WHERE id = ?`);
    stmt.run(...values);
}

/**
 * 获取历史记录列表
 * @param {object} filters - 筛选条件
 * @param {number} page - 页码（从 1 开始）
 * @param {number} pageSize - 每页数量
 * @returns {{items: object[], total: number, page: number, pageSize: number}}
 */
export function getList(filters = {}, page = 1, pageSize = 20) {
    const db = getDb();

    const conditions = [];
    const params = [];

    if (filters.status && filters.status !== 'all') {
        conditions.push('status = ?');
        params.push(filters.status);
    }
    if (filters.modelId) {
        conditions.push('model_id LIKE ?');
        params.push(`%${filters.modelId}%`);
    }
    if (filters.search) {
        conditions.push('(prompt LIKE ? OR response_text LIKE ?)');
        params.push(`%${filters.search}%`, `%${filters.search}%`);
    }
    if (filters.startDate) {
        conditions.push('created_at >= ?');
        params.push(new Date(filters.startDate).setHours(0, 0, 0, 0));
    }
    if (filters.endDate) {
        conditions.push('created_at <= ?');
        params.push(new Date(filters.endDate).setHours(23, 59, 59, 999));
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // 获取总数
    const countStmt = db.prepare(`SELECT COUNT(*) as count FROM requests ${whereClause}`);
    const { count: total } = countStmt.get(...params);

    // 获取分页数据
    const offset = (page - 1) * pageSize;
    const dataStmt = db.prepare(`
        SELECT * FROM requests ${whereClause}
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
    `);
    const items = dataStmt.all(...params, pageSize, offset).map(row => ({
        ...row,
        inputImages: row.input_images ? JSON.parse(row.input_images) : [],
        responseMedia: row.response_media ? JSON.parse(row.response_media) : [],
        isStreaming: row.is_streaming === 1
    }));

    return { items, total, page, pageSize };
}

/**
 * 获取单条记录详情
 * @param {string} id - 记录 ID
 * @returns {object|null}
 */
export function getDetail(id) {
    const db = getDb();
    const stmt = db.prepare('SELECT * FROM requests WHERE id = ?');
    const row = stmt.get(id);

    if (!row) return null;

    return {
        ...row,
        inputImages: row.input_images ? JSON.parse(row.input_images) : [],
        responseMedia: row.response_media ? JSON.parse(row.response_media) : [],
        isStreaming: row.is_streaming === 1
    };
}

/**
 * 删除记录
 * @param {string[]} ids - 要删除的记录 ID 数组
 * @returns {number} 删除的记录数
 */
export async function deleteRecords(ids) {
    if (!ids || ids.length === 0) return 0;

    const db = getDb();

    // 先获取要删除记录的媒体文件
    const placeholders = ids.map(() => '?').join(',');
    const selectStmt = db.prepare(`SELECT response_media FROM requests WHERE id IN (${placeholders})`);
    const rows = selectStmt.all(...ids);

    // 删除关联的媒体文件
    for (const row of rows) {
        if (row.response_media) {
            try {
                const media = JSON.parse(row.response_media);
                for (const item of media) {
                    if (item.localPath) {
                        try {
                            await fs.unlink(item.localPath);
                        } catch (e) {
                            // 文件可能不存在，忽略
                        }
                    }
                }
            } catch (e) {
                // JSON 解析失败，忽略
            }
        }
    }

    // 删除数据库记录
    const deleteStmt = db.prepare(`DELETE FROM requests WHERE id IN (${placeholders})`);
    const result = deleteStmt.run(...ids);

    return result.changes;
}

/**
 * 按日期范围删除记录
 * @param {string} startDate - 开始日期 (YYYY-MM-DD)
 * @param {string} endDate - 结束日期 (YYYY-MM-DD)
 * @returns {number} 删除的记录数
 */
export async function deleteByDateRange(startDate, endDate) {
    const db = getDb();

    const start = new Date(startDate).setHours(0, 0, 0, 0);
    const end = new Date(endDate).setHours(23, 59, 59, 999);

    // 先获取要删除的记录 ID
    const selectStmt = db.prepare('SELECT id FROM requests WHERE created_at >= ? AND created_at <= ?');
    const rows = selectStmt.all(start, end);
    const ids = rows.map(r => r.id);

    return await deleteRecords(ids);
}

/**
 * 保存媒体文件到本地
 * @param {string} dataUri - data URI 格式的媒体数据
 * @param {string} requestId - 请求 ID
 * @param {string|null} originalUrl - 原始下载 URL（用于重试）
 * @returns {{type: string, originalUrl: string, localPath: string, status: string}}
 */
export async function saveMediaToFile(dataUri, requestId, originalUrl = null) {
    const result = {
        type: 'unknown',
        originalUrl: originalUrl,  // 保存原始 URL 用于重试
        localPath: null,
        status: 'pending'
    };

    try {
        // 解析 data URI
        const match = dataUri.match(/^data:([^;]+);base64,(.+)$/);
        if (!match) {
            // 如果不是 data URI，可能是普通 URL
            result.originalUrl = dataUri;
            result.status = 'external';
            return result;
        }

        const [, mimeType, base64Data] = match;
        result.type = mimeType.startsWith('image/') ? 'image' : mimeType.startsWith('video/') ? 'video' : 'file';

        // 确定文件扩展名
        const extMap = {
            'image/png': 'png',
            'image/jpeg': 'jpg',
            'image/gif': 'gif',
            'image/webp': 'webp',
            'video/mp4': 'mp4',
            'video/webm': 'webm'
        };
        const ext = extMap[mimeType] || mimeType.split('/')[1] || 'bin';

        // 生成文件名
        const filename = `${requestId}_${Date.now()}.${ext}`;
        const filePath = path.join(MEDIA_DIR, filename);

        // 写入文件
        const buffer = Buffer.from(base64Data, 'base64');
        await fs.writeFile(filePath, buffer);

        result.localPath = filePath;
        result.status = 'downloaded';

        logger.debug('历史记录', `媒体文件已保存: ${filename}`);
    } catch (error) {
        logger.error('历史记录', `保存媒体文件失败: ${error.message}`);
        result.status = 'failed';
    }

    return result;
}

/**
 * 处理响应中的媒体内容
 * @param {object} result - 生成结果 {text, image, imageUrl, reasoning}
 * @param {string} requestId - 请求 ID
 * @returns {object[]} 媒体信息数组
 */
export async function processResponseMedia(result, requestId) {
    const media = [];

    // 处理直接返回的图片/视频（带原始 URL）
    if (result.image) {
        const mediaInfo = await saveMediaToFile(result.image, requestId, result.imageUrl || null);
        media.push(mediaInfo);
    }

    // 从 markdown 中提取图片（这些没有原始 URL）
    if (result.text) {
        const mdImagePattern = /!\[([^\]]*)\]\((data:[^)]+)\)/g;
        let match;
        while ((match = mdImagePattern.exec(result.text)) !== null) {
            const dataUri = match[2];
            const mediaInfo = await saveMediaToFile(dataUri, requestId, null);
            media.push(mediaInfo);
        }
    }

    return media;
}

/**
 * 重试下载失败的媒体
 * @param {string} id - 记录 ID
 * @param {number} mediaIndex - 媒体索引
 * @param {Function} [downloadFn] - 可选的下载函数（使用浏览器上下文下载）
 * @returns {{success: boolean, message: string}}
 */
export async function retryMediaDownload(id, mediaIndex, downloadFn = null) {
    const record = getDetail(id);
    if (!record) {
        return { success: false, message: '记录不存在' };
    }

    const media = record.responseMedia;
    if (!media || mediaIndex >= media.length) {
        return { success: false, message: '媒体索引无效' };
    }

    const item = media[mediaIndex];
    if (item.status === 'downloaded' && item.localPath) {
        // 检查文件是否存在
        try {
            await fs.access(item.localPath);
            return { success: true, message: '媒体已下载' };
        } catch {
            // 文件不存在，继续重试
        }
    }

    if (!item.originalUrl) {
        return { success: false, message: '无原始 URL，无法重试下载' };
    }

    // 使用浏览器上下文下载（推荐）或简单 HTTP 下载（后备）
    try {
        let dataUri = null;

        if (downloadFn) {
            // 使用浏览器上下文下载
            logger.info('历史记录', `使用浏览器下载: ${item.originalUrl}`);
            const result = await downloadFn(item.originalUrl);
            if (result.error) {
                return { success: false, message: result.error };
            }
            dataUri = result.image;
        } else {
            // 后备：简单 HTTP 下载（对于需要认证的 URL 可能会失败）
            logger.info('历史记录', `使用 HTTP 下载: ${item.originalUrl}`);
            const response = await fetch(item.originalUrl, {
                timeout: 60000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });

            if (!response.ok) {
                return { success: false, message: `下载失败: HTTP ${response.status}（可能需要认证）` };
            }

            const buffer = Buffer.from(await response.arrayBuffer());
            const contentType = response.headers.get('content-type') || 'application/octet-stream';
            const mimeType = contentType.split(';')[0].trim();
            dataUri = `data:${mimeType};base64,${buffer.toString('base64')}`;
        }

        // 保存到文件
        const saved = await saveMediaToFile(dataUri, id, item.originalUrl);

        if (saved.status === 'downloaded') {
            // 更新记录
            media[mediaIndex] = {
                ...item,
                ...saved
            };
            updateRecord(id, { responseMedia: media });

            logger.info('历史记录', `媒体重试下载成功: ${saved.localPath}`);
            return { success: true, message: '下载成功' };
        } else {
            return { success: false, message: '保存文件失败' };
        }

    } catch (error) {
        logger.error('历史记录', `媒体重试下载失败: ${error.message}`);
        return { success: false, message: `下载失败: ${error.message}` };
    }
}

/**
 * 获取统计摘要
 * @param {object} filters - 筛选条件
 * @returns {{total: number, success: number, failed: number, avgDuration: number}}
 */
export function getStats(filters = {}) {
    const db = getDb();

    const conditions = [];
    const params = [];

    if (filters.startDate) {
        conditions.push('created_at >= ?');
        params.push(new Date(filters.startDate).setHours(0, 0, 0, 0));
    }
    if (filters.endDate) {
        conditions.push('created_at <= ?');
        params.push(new Date(filters.endDate).setHours(23, 59, 59, 999));
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const stmt = db.prepare(`
        SELECT
            COUNT(*) as total,
            SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
            AVG(CASE WHEN duration_ms IS NOT NULL THEN duration_ms ELSE NULL END) as avgDuration
        FROM requests ${whereClause}
    `);

    const result = stmt.get(...params);
    return {
        total: result.total || 0,
        success: result.success || 0,
        failed: result.failed || 0,
        avgDuration: Math.round(result.avgDuration || 0)
    };
}

/**
 * 获取可用的模型列表（从历史记录中）
 * @returns {string[]}
 */
export function getModelList() {
    const db = getDb();
    const stmt = db.prepare('SELECT DISTINCT model_id FROM requests WHERE model_id IS NOT NULL ORDER BY model_id');
    return stmt.all().map(r => r.model_id);
}

/**
 * 获取媒体目录路径
 * @returns {string}
 */
export function getMediaDir() {
    return MEDIA_DIR;
}
