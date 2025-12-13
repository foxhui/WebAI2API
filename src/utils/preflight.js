/**
 * @fileoverview 服务器启动前自检模块
 * @description 检查补丁、Camoufox 可执行文件、version.json、GeoLite2 数据库和 better-sqlite3 是否就绪。
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { logger } from './logger.js';

const PROJECT_ROOT = process.cwd();

/**
 * 计算文件的 MD5 哈希值
 * @param {string} filePath - 文件路径
 * @returns {string|null} MD5 哈希值，文件不存在返回 null
 */
function getFileMD5(filePath) {
    if (!fs.existsSync(filePath)) return null;

    const content = fs.readFileSync(filePath);
    return crypto.createHash('md5').update(content).digest('hex');
}

/**
 * 获取 Camoufox 可执行文件路径（根据平台）
 * @returns {string}
 */
function getCamoufoxExecutablePath() {
    const camoufoxDir = path.join(PROJECT_ROOT, 'camoufox');
    const platform = os.platform();

    if (platform === 'win32') {
        return path.join(camoufoxDir, 'camoufox.exe');
    } else if (platform === 'darwin') {
        return path.join(camoufoxDir, 'Camoufox.app', 'Contents', 'MacOS', 'camoufox');
    } else {
        return path.join(camoufoxDir, 'camoufox');
    }
}

/**
 * 执行服务器启动前自检
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function preflight() {
    const errors = [];

    // 1. 检查 better-sqlite3 预编译文件
    const sqlitePath = path.join(PROJECT_ROOT, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');
    if (!fs.existsSync(sqlitePath)) {
        errors.push('better-sqlite3 预编译文件缺失，请运行: npm run init');
    }

    // 2. 检查 camoufox-js 补丁（通过 MD5 对比）
    const patchDir = path.join(PROJECT_ROOT, 'patches');
    const targetDir = path.join(PROJECT_ROOT, 'node_modules', 'camoufox-js', 'dist');

    const patchFiles = {
        'camoufox-js@0.8.3.locale.patched.js': 'locale.js',
        'camoufox-js@0.8.3.pkgman.patched.js': 'pkgman.js'
    };

    for (const [patchName, targetName] of Object.entries(patchFiles)) {
        const patchPath = path.join(patchDir, patchName);
        const targetPath = path.join(targetDir, targetName);

        const patchHash = getFileMD5(patchPath);
        const targetHash = getFileMD5(targetPath);

        if (!patchHash) {
            // 补丁源文件不存在，跳过检查
            continue;
        }

        if (patchHash !== targetHash) {
            errors.push('camoufox-js 补丁未应用，请运行: pnpm install');
            break; // 只报告一次
        }
    }

    // 3. 检查 Camoufox 可执行文件
    const executablePath = getCamoufoxExecutablePath();
    if (!fs.existsSync(executablePath)) {
        errors.push(`Camoufox 可执行文件缺失，请运行: npm run init`);
    }

    // 4. 检查 version.json
    const versionJsonPath = path.join(PROJECT_ROOT, 'camoufox', 'version.json');
    if (!fs.existsSync(versionJsonPath)) {
        errors.push('camoufox/version.json 缺失，请运行: npm run init');
    }

    // 5. 检查 GeoLite2-City.mmdb
    const geoDbPath = path.join(PROJECT_ROOT, 'camoufox', 'GeoLite2-City.mmdb');
    if (!fs.existsSync(geoDbPath)) {
        errors.push('camoufox/GeoLite2-City.mmdb 缺失，请运行: npm run init');
    }

    return {
        ok: errors.length === 0,
        errors
    };
}

/**
 * 执行自检并在失败时退出程序
 */
export function runPreflight() {
    logger.info('服务器', '正在执行自检...');

    const result = preflight();

    if (!result.ok) {
        logger.error('服务器', '自检失败，以下依赖缺失:');
        for (const err of result.errors) {
            logger.error('服务器', `  - ${err}`);
        }
        logger.error('服务器', '提示: 您可以使用 npm run init -- -custom 来自定义初始化步骤');
        process.exit(1);
    }

    logger.info('服务器', '自检通过');
}
