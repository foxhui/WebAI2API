/**
 * @fileoverview npm postinstall 钩子脚本
 * @description 在 `npm install` 后自动应用 camoufox-js 补丁。
 *
 * 用法：在 package.json scripts 中配置 "postinstall": "node scripts/postinstall.js"
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..');

// 简易日志
const log = (msg) => console.log(`[postinstall] ${msg}`);
const warn = (msg) => console.warn(`[postinstall] ⚠️ ${msg}`);
const error = (msg) => console.error(`[postinstall] ❌ ${msg}`);

/**
 * 复制 camoufox-js 补丁文件到 node_modules
 */
function patchCamoufoxJs() {
    log('正在应用 camoufox-js 补丁...');

    const patchDir = path.join(PROJECT_ROOT, 'patches');
    const targetDir = path.join(PROJECT_ROOT, 'node_modules', 'camoufox-js', 'dist');

    // 检查目标目录是否存在
    if (!fs.existsSync(targetDir)) {
        warn(`目标目录不存在: ${targetDir}`);
        warn('camoufox-js 可能未安装，跳过补丁。');
        return;
    }

    // 补丁文件映射: 源文件名 -> 目标文件名
    const patches = {
        'camoufox-js@0.8.3.locale.patched.js': 'locale.js',
        'camoufox-js@0.8.3.pkgman.patched.js': 'pkgman.js'
    };

    for (const [srcName, destName] of Object.entries(patches)) {
        const srcPath = path.join(patchDir, srcName);
        const destPath = path.join(targetDir, destName);

        if (!fs.existsSync(srcPath)) {
            warn(`补丁文件不存在: ${srcPath}`);
            continue;
        }

        try {
            fs.copyFileSync(srcPath, destPath);
            log(`已应用补丁: ${srcName} -> ${destName}`);
        } catch (e) {
            error(`应用补丁失败: ${e.message}`);
        }
    }

    log('补丁应用完成。');
}

// 执行
patchCamoufoxJs();
