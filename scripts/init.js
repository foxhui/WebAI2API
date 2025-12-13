/**
 * @fileoverview 运行环境初始化脚本（CLI）
 * @description 用于下载/准备运行所需依赖（如 Camoufox、better-sqlite3 等），并按需更新 `config.yaml`。
 *
 * 用法：`npm run init`
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { gotScraping } from 'got-scraping';
import compressing from 'compressing';
import yaml from 'yaml';
import { logger } from '../src/utils/logger.js';
import { getHttpProxy, getProxyConfig } from '../src/utils/proxy.js';
import { select } from '@inquirer/prompts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..');
const TEMP_DIR = path.join(PROJECT_ROOT, 'data', 'temp');
const CONFIG_PATH = path.join(PROJECT_ROOT, 'config.yaml');

// 确保临时目录存在
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

/**
 * 获取 Node.js ABI 版本
 */
function getNodeABI() {
    return process.versions.modules;
}

/**
 * 获取平台信息
 */
function getPlatformInfo() {
    const platform = os.platform();
    const arch = os.arch();
    const nodeVersion = process.version;
    const abi = getNodeABI();

    return { platform, arch, nodeVersion, abi };
}

/**
 * 验证平台支持
 */
function validatePlatform(platform, arch) {
    const supported = {
        'win32': ['x64'],
        'darwin': ['x64', 'arm64'],
        'linux': ['x64', 'arm64']
    };

    if (!supported[platform] || !supported[platform].includes(arch)) {
        return false;
    }

    return true;
}

/**
 * 验证 Node.js ABI 版本支持
 */
function validateABI(abi) {
    const supportedABIs = [115, 121, 123, 125, 127, 128, 130, 131, 132, 133, 135, 136, 137, 139, 140, 141];
    return supportedABIs.includes(parseInt(abi, 10));
}

/**
 * 下载文件（带进度，流式，支持重试）
 * @param {string} url - 下载地址
 * @param {string} destPath - 目标文件路径
 * @param {string|null} proxyUrl - 代理 URL
 * @param {number} maxRetries - 最大重试次数
 */
async function downloadFile(url, destPath, proxyUrl = null, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            if (attempt > 1) {
                logger.info('初始化', `第 ${attempt}/${maxRetries} 次尝试下载...`);
                // 删除之前失败的文件
                try {
                    if (fs.existsSync(destPath)) {
                        fs.unlinkSync(destPath);
                    }
                } catch (e) { }
            } else {
                logger.info('初始化', `开始下载: ${url}`);
            }

            await downloadFileOnce(url, destPath, proxyUrl);
            return destPath;
        } catch (error) {
            logger.error('初始化', `下载失败 (尝试 ${attempt}/${maxRetries}): ${error.message}`);

            if (attempt === maxRetries) {
                throw error;
            }

            // 等待后重试（递增延迟）
            const delay = attempt * 2000;
            logger.info('初始化', `${delay / 1000} 秒后重试...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

/**
 * 单次下载尝试（内部函数）
 */
async function downloadFileOnce(url, destPath, proxyUrl = null) {
    return new Promise((resolve, reject) => {
        const options = {
            http2: false,
            timeout: {
                request: 900000,  // 总请求超时 15 分钟
                read: 180000      // 两次数据接收间隔超时 3 分钟
            },
            retry: {
                limit: 0
            },
            headerGeneratorOptions: {
                browsers: [],
                devices: [],
                locales: [],
                operatingSystems: []
            },
            headers: {
                'user-agent': 'Wget/1.21.4 (linux-gnu)',
                'accept': '*/*',
                'accept-encoding': 'identity',
                'connection': 'keep-alive'
            }
        };

        if (proxyUrl) {
            options.proxyUrl = proxyUrl;
        }

        const downloadStream = gotScraping.stream(url, options);
        const fileStream = fs.createWriteStream(destPath);

        let downloadedSize = 0;
        let totalSize = 0;
        let lastLogTime = Date.now();

        downloadStream.on('response', (response) => {
            totalSize = parseInt(response.headers['content-length'] || '0', 10);
            if (totalSize > 0) {
                logger.info('初始化', `文件大小: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
            }
        });

        downloadStream.on('data', (chunk) => {
            downloadedSize += chunk.length;

            // 每秒更新一次进度
            const now = Date.now();
            if (totalSize > 0 && now - lastLogTime > 1000) {
                const percent = ((downloadedSize / totalSize) * 100).toFixed(1);
                const downloadedMB = (downloadedSize / 1024 / 1024).toFixed(2);
                const totalMB = (totalSize / 1024 / 1024).toFixed(2);
                logger.info('初始化', `下载进度: ${percent}% (${downloadedMB}MB / ${totalMB}MB)`);
                lastLogTime = now;
            }
        });

        downloadStream.on('error', (error) => {
            fileStream.close();
            try {
                fs.unlinkSync(destPath);
            } catch (e) { }
            reject(error);
        });

        fileStream.on('error', (error) => {
            reject(error);
        });

        fileStream.on('finish', () => {
            const finalSize = (downloadedSize / 1024 / 1024).toFixed(2);

            // 验证下载完整性
            if (totalSize > 0 && downloadedSize !== totalSize) {
                const errorMsg = `下载不完整: 预期 ${(totalSize / 1024 / 1024).toFixed(2)} MB, 实际 ${finalSize} MB`;
                logger.error('初始化', errorMsg);

                // 清理损坏的文件
                try {
                    fs.unlinkSync(destPath);
                } catch (e) { }

                reject(new Error(errorMsg));
                return;
            }

            logger.info('初始化', `下载完成: ${finalSize} MB`);
            resolve(destPath);
        });

        downloadStream.pipe(fileStream);
    });
}

/**
 * 构建 better-sqlite3 下载 URL
 */
function getBetterSqlite3Url(platform, arch, abi) {
    const version = '12.5.0';
    const platformMap = {
        'win32': 'win32',
        'darwin': 'darwin',
        'linux': 'linux'
    };

    const platformName = platformMap[platform];
    const archName = arch; // x64 或 arm64

    return `https://github.com/WiseLibs/better-sqlite3/releases/download/v${version}/better-sqlite3-v${version}-node-v${abi}-${platformName}-${archName}.tar.gz`;
}

/**
 * 下载并安装 better-sqlite3
 */
async function installBetterSqlite3(platform, arch, abi, proxyUrl) {
    logger.info('初始化', '开始安装 better-sqlite3...');

    const url = getBetterSqlite3Url(platform, arch, abi);
    const downloadPath = path.join(TEMP_DIR, 'better-sqlite3.tar.gz');

    // 下载
    await downloadFile(url, downloadPath, proxyUrl);

    // 解压 .tar.gz 文件
    logger.info('初始化', '正在解压 better-sqlite3...');
    await compressing.tgz.uncompress(downloadPath, TEMP_DIR);

    // 查找 better_sqlite3.node
    const files = fs.readdirSync(TEMP_DIR, { recursive: true });
    const nodeFile = files.find(f => f.endsWith('better_sqlite3.node'));
    if (!nodeFile) {
        throw new Error('未找到 better_sqlite3.node 文件');
    }

    // 复制到 node_modules
    const buildDir = path.join(PROJECT_ROOT, 'node_modules', 'better-sqlite3', 'build', 'Release');
    if (!fs.existsSync(buildDir)) {
        fs.mkdirSync(buildDir, { recursive: true });
    }

    const sourcePath = path.join(TEMP_DIR, nodeFile);
    const destPath = path.join(buildDir, 'better_sqlite3.node');
    fs.copyFileSync(sourcePath, destPath);

    logger.info('初始化', `better-sqlite3 安装成功: ${destPath}`);

    // 清理
    fs.unlinkSync(downloadPath);
    // 清理解压后的所有文件
    files.forEach(f => {
        const filePath = path.join(TEMP_DIR, f);
        try {
            if (fs.existsSync(filePath)) {
                const stat = fs.statSync(filePath);
                if (stat.isDirectory()) {
                    fs.rmSync(filePath, { recursive: true, force: true });
                } else {
                    fs.unlinkSync(filePath);
                }
            }
        } catch (e) { }
    });
}

/**
 * 构建 Camoufox 下载 URL
 */
function getCamoufoxUrl(platform, arch) {
    const version = '135.0.1-beta.24';
    const platformMap = {
        'win32': 'win',
        'darwin': 'mac',
        'linux': 'lin'
    };

    const archMap = {
        'x64': 'x86_64',
        'arm64': 'arm64'
    };

    const platformName = platformMap[platform];
    const archName = archMap[arch];

    return `https://github.com/daijro/camoufox/releases/download/v${version}/camoufox-${version}-${platformName}.${archName}.zip`;
}

/**
 * 下载并安装 Camoufox
 */
async function installCamoufox(platform, arch, proxyUrl) {
    logger.info('初始化', '开始安装 Camoufox 浏览器...');

    const url = getCamoufoxUrl(platform, arch);
    const downloadPath = path.join(TEMP_DIR, 'camoufox.zip');

    // 下载
    await downloadFile(url, downloadPath, proxyUrl);

    // 解压 .zip 文件到 camoufox 目录
    logger.info('初始化', '正在解压 Camoufox...');
    const camoufoxDir = path.join(PROJECT_ROOT, 'camoufox');
    if (!fs.existsSync(camoufoxDir)) {
        fs.mkdirSync(camoufoxDir, { recursive: true });
    }

    await compressing.zip.uncompress(downloadPath, camoufoxDir);

    // macOS 专用：复制 properties.json 到 MacOS 目录
    if (platform === 'darwin') {
        const resourcesPath = path.join(camoufoxDir, 'Camoufox.app', 'Contents', 'Resources', 'properties.json');
        const macOSDir = path.join(camoufoxDir, 'Camoufox.app', 'Contents', 'MacOS');
        const macOSPath = path.join(macOSDir, 'properties.json');

        if (fs.existsSync(resourcesPath)) {
            // 确保目标目录存在
            if (!fs.existsSync(macOSDir)) {
                fs.mkdirSync(macOSDir, { recursive: true });
            }
            fs.copyFileSync(resourcesPath, macOSPath);
            logger.info('初始化', `已复制 properties.json 到 MacOS 目录`);
        } else {
            logger.warn('初始化', `未找到 properties.json: ${resourcesPath}`);
        }
    }

    logger.info('初始化', `Camoufox 安装成功: ${camoufoxDir}`);

    // 更新 config.yaml
    updateConfigPath(platform, camoufoxDir);

    // 创建 version.json
    const versionJsonPath = path.join(camoufoxDir, 'version.json');
    const versionData = {
        version: "135.0",
        release: "beta.24"
    };
    fs.writeFileSync(versionJsonPath, JSON.stringify(versionData, null, 2), 'utf8');
    logger.info('初始化', `已生成 version.json: ${versionJsonPath}`);

    // 清理
    fs.unlinkSync(downloadPath);
}

/**
 * 更新 config.yaml 中的 browser.path
 */
function updateConfigPath(platform, camoufoxDir) {
    try {
        const configContent = fs.readFileSync(CONFIG_PATH, 'utf8');

        // 解析为文档对象 (CST)
        const doc = yaml.parseDocument(configContent);

        // 构造绝对路径
        let browserPath;
        if (platform === 'win32') {
            browserPath = path.join(camoufoxDir, 'camoufox.exe');
        } else if (platform === 'darwin') {
            browserPath = path.join(camoufoxDir, 'Camoufox.app', 'Contents', 'MacOS', 'camoufox');
        } else {
            browserPath = path.join(camoufoxDir, 'camoufox');
        }

        // 规范化路径分隔符
        browserPath = browserPath.replace(/\\/g, '/');

        // 安全地更新路径，如果节点不存在则创建
        if (!doc.has('browser')) {
            doc.set('browser', { path: browserPath });
        } else {
            const browserNode = doc.get('browser');
            if (browserNode && typeof browserNode.set === 'function') {
                browserNode.set('path', browserPath);
            } else {
                // 如果 browser 不是对象（理论上不应该发生），强制覆盖
                doc.set('browser', { path: browserPath });
            }
        }

        // 转回字符串，保留注释
        const updatedYaml = doc.toString();
        fs.writeFileSync(CONFIG_PATH, updatedYaml, 'utf8');

        logger.info('初始化', `已更新配置文件 browser.path: ${browserPath}`);
    } catch (e) {
        logger.error('初始化', '更新配置文件失败', { error: e.message });
    }
}

/**
 * 主流程
 */
(async () => {
    try {
        logger.info('初始化', '========================================');
        logger.info('初始化', '依赖初始化脚本启动');
        logger.info('初始化', '========================================');

        // 显示系统信息
        const { platform, arch, nodeVersion, abi } = getPlatformInfo();
        logger.info('初始化', `操作系统: ${platform}`);
        logger.info('初始化', `芯片架构: ${arch}`);
        logger.info('初始化', `Node.js 版本: ${nodeVersion}`);
        logger.info('初始化', `Node.js ABI 版本: ${abi}`);

        // 验证平台支持
        if (!validatePlatform(platform, arch)) {
            logger.error('初始化', '不支持的平台！');
            logger.error('初始化', `因该项目使用了 Camoufox 浏览器，没有您设备可用的预编译版本`);
            logger.error('初始化', `支持的平台: Windows x64, macOS x64/arm64, Linux x64/arm64`);
            process.exit(1);
        }

        logger.info('初始化', '平台支持检查通过');

        // 验证 ABI 版本支持
        if (!validateABI(abi)) {
            logger.error('初始化', '不支持的 Node.js ABI 版本！');
            logger.error('初始化', `当前 ABI 版本: ${abi}`);
            logger.error('初始化', `支持的 ABI 版本: 115, 121, 123, 125, 127, 128, 130, 131, 132, 133, 135, 136, 137, 139, 140, 141`);
            logger.error('初始化', `建议使用 Node.js 20.10.0 或更高版本`);
            process.exit(1);
        }

        logger.info('初始化', 'ABI 版本检查通过');

        // 读取并转换代理配置
        let proxyUrl = null;
        try {
            const configContent = fs.readFileSync(CONFIG_PATH, 'utf8');
            const config = yaml.parse(configContent);
            const proxyConfig = getProxyConfig(config);
            if (proxyConfig) {
                proxyUrl = await getHttpProxy(proxyConfig);
            }
        } catch (e) {
            logger.warn('初始化', '无法读取配置文件或转换代理，不使用代理');
        }

        // 检查是否为自定义模式
        const isCustomMode = process.argv.includes('-custom');

        if (isCustomMode) {
            // 自定义模式：交互式选择步骤
            const action = await select({
                message: '请选择要执行的操作:',
                choices: [
                    { name: '安装 better-sqlite3 预编译文件', value: 'sqlite' },
                    { name: '安装 Camoufox 浏览器', value: 'camoufox' },
                    { name: '安装 GeoLite2-City.mmdb 数据库', value: 'geolite' },
                    { name: '修复 macOS 环境下的 properties.json', value: 'macos_fix' },
                    { name: '修复 version.json 缺失', value: 'version_fix' },
                    { name: '退出', value: 'exit' }
                ]
            });

            switch (action) {
                case 'sqlite':
                    await installBetterSqlite3(platform, arch, abi, proxyUrl);
                    break;
                case 'camoufox':
                    await installCamoufox(platform, arch, proxyUrl);
                    break;
                case 'geolite':
                    await downloadGeoLiteDb(proxyUrl, true); // 强制下载
                    break;
                case 'macos_fix':
                    fixMacOSProperties();
                    break;
                case 'version_fix':
                    fixVersionJson();
                    break;
                case 'exit':
                    logger.info('初始化', '已退出');
                    break;
            }
        } else {
            // 正常模式：执行所有步骤
            await installBetterSqlite3(platform, arch, abi, proxyUrl);
            await installCamoufox(platform, arch, proxyUrl);
            await downloadGeoLiteDb(proxyUrl);
        }

        logger.info('初始化', '========================================');
        logger.info('初始化', '操作完成！');
        logger.info('初始化', '========================================');
        process.exit(0);

    } catch (err) {
        logger.error('初始化', '初始化失败', { error: err.message });
        process.exit(1);
    }
})();

/**
 * 下载 GeoLite2-City.mmdb 到 camoufox 目录
 * @param {string|null} proxyUrl - 代理 URL
 * @param {boolean} [force=false] - 是否强制下载（忽略已存在检查）
 */
async function downloadGeoLiteDb(proxyUrl, force = false) {
    const camoufoxDir = path.join(PROJECT_ROOT, 'camoufox');
    const destPath = path.join(camoufoxDir, 'GeoLite2-City.mmdb');

    // 确保目录存在
    if (!fs.existsSync(camoufoxDir)) {
        fs.mkdirSync(camoufoxDir, { recursive: true });
    }

    // 如果已存在且非强制模式，跳过下载
    if (!force && fs.existsSync(destPath)) {
        logger.info('初始化', 'GeoLite2-City.mmdb 已存在，跳过下载');
        return;
    }

    logger.info('初始化', '开始下载 GeoLite2-City.mmdb...');
    const url = 'https://github.com/P3TERX/GeoLite.mmdb/releases/latest/download/GeoLite2-City.mmdb';
    await downloadFile(url, destPath, proxyUrl);
    logger.info('初始化', `GeoLite2-City.mmdb 下载完成: ${destPath}`);
}

/**
 * 修复 macOS 环境下的 properties.json
 */
function fixMacOSProperties() {
    const platform = os.platform();
    if (platform !== 'darwin') {
        logger.warn('初始化', '此操作仅适用于 macOS 系统');
        return;
    }

    const camoufoxDir = path.join(PROJECT_ROOT, 'camoufox');
    const resourcesPath = path.join(camoufoxDir, 'Camoufox.app', 'Contents', 'Resources', 'properties.json');
    const macOSDir = path.join(camoufoxDir, 'Camoufox.app', 'Contents', 'MacOS');
    const macOSPath = path.join(macOSDir, 'properties.json');

    if (!fs.existsSync(resourcesPath)) {
        logger.error('初始化', `源文件不存在: ${resourcesPath}`);
        logger.error('初始化', '请先安装 Camoufox 浏览器');
        return;
    }

    if (!fs.existsSync(macOSDir)) {
        fs.mkdirSync(macOSDir, { recursive: true });
    }

    fs.copyFileSync(resourcesPath, macOSPath);
    logger.info('初始化', `已复制 properties.json 到 MacOS 目录: ${macOSPath}`);
}

/**
 * 修复 version.json 缺失
 */
function fixVersionJson() {
    const camoufoxDir = path.join(PROJECT_ROOT, 'camoufox');
    const versionJsonPath = path.join(camoufoxDir, 'version.json');

    if (!fs.existsSync(camoufoxDir)) {
        logger.error('初始化', `camoufox 目录不存在: ${camoufoxDir}`);
        logger.error('初始化', '请先安装 Camoufox 浏览器');
        return;
    }

    const versionData = {
        version: "135.0",
        release: "beta.24"
    };

    fs.writeFileSync(versionJsonPath, JSON.stringify(versionData, null, 2), 'utf8');
    logger.info('初始化', `已生成 version.json: ${versionJsonPath}`);
}
