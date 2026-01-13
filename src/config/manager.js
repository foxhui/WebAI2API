/**
 * @fileoverview 配置管理模块
 * @description 提供配置读取和写入能力，支持分段更新
 */

import fs from 'fs';
import path from 'path';
import yaml from 'yaml';
import { logger } from '../utils/logger.js';
import { getConfigPath } from './index.js';

/**
 * 读取原始配置（不带缓存，直接从磁盘读取）
 * @returns {object} 原始配置对象
 */
function readRawConfig() {
    const configPath = getConfigPath();
    if (!fs.existsSync(configPath)) {
        throw new Error('配置文件不存在');
    }
    const content = fs.readFileSync(configPath, 'utf8');
    return yaml.parse(content);
}

/**
 * 写入配置到文件
 * @param {object} config - 完整配置对象
 */
function writeConfig(config) {
    const configPath = getConfigPath();
    // 使用 yaml 库的默认序列化（会丢失注释，但结构正确）
    const content = yaml.stringify(config, {
        indent: 2,
        lineWidth: 0 // 不自动换行
    });
    fs.writeFileSync(configPath, content, 'utf8');
    logger.info('管理器', `配置已保存到 ${configPath}`);
}

/**
 * 获取服务器配置
 * @returns {object}
 */
export function getServerConfig() {
    const config = readRawConfig();
    return {
        port: config.server?.port || 3000,
        authToken: config.server?.auth || '',
        keepaliveMode: config.server?.keepalive?.mode || 'comment'
    };
}

/**
 * 保存服务器配置
 * @param {object} data - 服务器配置
 */
export function saveServerConfig(data) {
    const config = readRawConfig();

    if (!config.server) config.server = {};

    if (data.port !== undefined) config.server.port = data.port;
    if (data.authToken !== undefined) config.server.auth = data.authToken;
    if (data.keepaliveMode !== undefined) {
        if (!config.server.keepalive) config.server.keepalive = {};
        config.server.keepalive.mode = data.keepaliveMode;
    }

    writeConfig(config);
}

/**
 * 获取浏览器配置
 * @returns {object}
 */
export function getBrowserConfig() {
    const config = readRawConfig();
    const browser = config.browser || {};
    const proxy = browser.proxy || {};
    const cssInject = browser.cssInject || {};

    return {
        path: browser.path || '',
        headless: browser.headless || false,
        fission: browser.fission !== false, // 默认 true
        cssInject: {
            animation: cssInject.animation || false,
            filter: cssInject.filter || false,
            font: cssInject.font || false
        },
        proxy: {
            enable: proxy.enable || false,
            type: proxy.type || 'http',
            host: proxy.host || '',
            port: proxy.port || 0,
            auth: !!(proxy.user || proxy.passwd),
            username: proxy.user || '',
            password: proxy.passwd || ''
        }
    };
}

/**
 * 保存浏览器配置
 * @param {object} data - 浏览器配置
 */
export function saveBrowserConfig(data) {
    const config = readRawConfig();

    if (!config.browser) config.browser = {};

    if (data.path !== undefined) config.browser.path = data.path;
    if (data.headless !== undefined) config.browser.headless = data.headless;
    if (data.fission !== undefined) config.browser.fission = data.fission;

    // CSS 性能优化配置
    if (data.cssInject) {
        if (!config.browser.cssInject) config.browser.cssInject = {};
        const css = data.cssInject;
        if (css.animation !== undefined) config.browser.cssInject.animation = css.animation;
        if (css.filter !== undefined) config.browser.cssInject.filter = css.filter;
        if (css.font !== undefined) config.browser.cssInject.font = css.font;
    }

    if (data.proxy) {
        if (!config.browser.proxy) config.browser.proxy = {};
        const p = data.proxy;

        if (p.enable !== undefined) config.browser.proxy.enable = p.enable;
        if (p.type !== undefined) config.browser.proxy.type = p.type;
        if (p.host !== undefined) config.browser.proxy.host = p.host;
        if (p.port !== undefined) config.browser.proxy.port = p.port;
        if (p.username !== undefined) config.browser.proxy.user = p.username;
        if (p.password !== undefined) config.browser.proxy.passwd = p.password;
    }

    writeConfig(config);
}

/**
 * 获取队列配置
 * @returns {object}
 */
export function getQueueConfig() {
    const config = readRawConfig();
    return {
        queueBuffer: config.queue?.queueBuffer ?? 2,
        imageLimit: config.queue?.imageLimit ?? 5
    };
}

/**
 * 保存队列配置
 * @param {object} data - 队列配置
 */
export function saveQueueConfig(data) {
    const config = readRawConfig();

    if (!config.queue) config.queue = {};

    if (data.queueBuffer !== undefined) config.queue.queueBuffer = data.queueBuffer;
    if (data.imageLimit !== undefined) config.queue.imageLimit = data.imageLimit;

    writeConfig(config);
}

/**
 * 获取实例配置
 * @returns {object[]}
 */
export function getInstancesConfig() {
    const config = readRawConfig();
    const instances = config.backend?.pool?.instances || [];

    return instances.map(inst => ({
        name: inst.name,
        userDataMark: inst.userDataMark || null,
        proxy: inst.proxy ? {
            enable: inst.proxy.enable || false,
            type: inst.proxy.type || 'http',
            host: inst.proxy.host || '',
            port: inst.proxy.port || 0
        } : null,
        workers: (inst.workers || []).map(w => ({
            name: w.name,
            type: w.type,
            mergeTypes: w.mergeTypes || [],
            mergeMonitor: w.mergeMonitor || null
        }))
    }));
}

/**
 * 保存实例配置
 * @param {object[]} data - 实例配置列表
 */
export function saveInstancesConfig(data) {
    const config = readRawConfig();

    if (!config.backend) config.backend = {};
    if (!config.backend.pool) config.backend.pool = {};

    // 转换为 YAML 格式
    config.backend.pool.instances = data.map(inst => {
        const result = {
            name: inst.name
        };

        if (inst.userDataMark) {
            result.userDataMark = inst.userDataMark;
        }

        if (inst.proxy && inst.proxy.enable) {
            result.proxy = {
                enable: true,
                type: inst.proxy.type || 'http',
                host: inst.proxy.host,
                port: inst.proxy.port
            };
            if (inst.proxy.username) result.proxy.user = inst.proxy.username;
            if (inst.proxy.password) result.proxy.passwd = inst.proxy.password;
        }

        result.workers = (inst.workers || []).map(w => {
            const worker = {
                name: w.name,
                type: w.type
            };
            if (w.type === 'merge' && w.mergeTypes) {
                worker.mergeTypes = w.mergeTypes;
                if (w.mergeMonitor) worker.mergeMonitor = w.mergeMonitor;
            }
            return worker;
        });

        return result;
    });

    writeConfig(config);
}

/**
 * 获取适配器配置
 * @returns {object}
 */
export function getAdaptersConfig() {
    const config = readRawConfig();
    return config.backend?.adapter || {};
}

/**
 * 保存适配器配置
 * @param {object} data - 适配器配置（键值对）
 */
export function saveAdaptersConfig(data) {
    const config = readRawConfig();

    if (!config.backend) config.backend = {};

    // 合并而非覆盖，保留其他适配器配置
    config.backend.adapter = {
        ...(config.backend.adapter || {}),
        ...data
    };

    writeConfig(config);
}

/**
 * 获取 Pool 配置（负载均衡和故障转移）
 * @returns {object}
 */
export function getPoolConfig() {
    const config = readRawConfig();
    const pool = config.backend?.pool || {};
    const failover = pool.failover || {};

    return {
        strategy: pool.strategy || 'least_busy',
        failover: {
            enabled: failover.enabled !== false, // 默认 true
            maxRetries: failover.maxRetries ?? 2
        }
    };
}

/**
 * 保存 Pool 配置
 * @param {object} data - Pool 配置
 */
export function savePoolConfig(data) {
    const config = readRawConfig();

    if (!config.backend) config.backend = {};
    if (!config.backend.pool) config.backend.pool = {};

    if (data.strategy !== undefined) {
        config.backend.pool.strategy = data.strategy;
    }

    if (data.failover) {
        if (!config.backend.pool.failover) config.backend.pool.failover = {};
        if (data.failover.enabled !== undefined) {
            config.backend.pool.failover.enabled = data.failover.enabled;
        }
        if (data.failover.maxRetries !== undefined) {
            config.backend.pool.failover.maxRetries = data.failover.maxRetries;
        }
    }

    writeConfig(config);
}
