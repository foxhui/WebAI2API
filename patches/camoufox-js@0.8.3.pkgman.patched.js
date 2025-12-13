import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { setTimeout } from "node:timers/promises";
import AdmZip from "adm-zip";
import ProgressBar from "progress";
import { CONSTRAINTS } from "./__version__.js";
import { CamoufoxNotInstalled, FileNotFoundError, MissingRelease, UnsupportedArchitecture, UnsupportedOS, UnsupportedVersion, } from "./exceptions.js";
const ARCH_MAP = {
    x64: "x86_64",
    ia32: "i686",
    arm64: "arm64",
    arm: "arm64",
};
const OS_MAP = {
    darwin: "mac",
    linux: "lin",
    win32: "win",
};
if (!(process.platform in OS_MAP)) {
    throw new UnsupportedOS(`OS ${process.platform} is not supported`);
}
export const OS_NAME = OS_MAP[process.platform];
// [PATCH] Portable Mode: 优先使用项目目录下的 camoufox 文件夹
const localInstallDir = path.join(process.cwd(), "camoufox");
export const INSTALL_DIR = fs.existsSync(localInstallDir) ? localInstallDir : userCacheDir("camoufox");
//export const INSTALL_DIR = userCacheDir("camoufox");

export const LOCAL_DATA = path.join(import.meta.dirname, "data-files");
export const OS_ARCH_MATRIX = {
    win: ["x86_64", "i686"],
    mac: ["x86_64", "arm64"],
    lin: ["x86_64", "arm64", "i686"],
};
const LAUNCH_FILE = {
    win: "camoufox.exe",
    mac: "../MacOS/camoufox",
    lin: "camoufox-bin",
};
class Version {
    release;
    version;
    sorted_rel;
    constructor(release, version) {
        this.release = release;
        this.version = version;
        this.sorted_rel = this.buildSortedRel();
    }
    buildSortedRel() {
        const parts = this.release
            .split(".")
            .map((x) => Number.isNaN(Number(x)) ? x.charCodeAt(0) - 1024 : Number(x));
        while (parts.length < 5) {
            parts.push(0);
        }
        return parts;
    }
    get fullString() {
        return `${this.version}-${this.release}`;
    }
    equals(other) {
        return this.sorted_rel.join(".") === other.sorted_rel.join(".");
    }
    lessThan(other) {
        for (let i = 0; i < this.sorted_rel.length; i++) {
            if (this.sorted_rel[i] < other.sorted_rel[i])
                return true;
            if (this.sorted_rel[i] > other.sorted_rel[i])
                return false;
        }
        return false;
    }
    isSupported() {
        return VERSION_MIN.lessThan(this) && this.lessThan(VERSION_MAX);
    }
    static fromPath(filePath = INSTALL_DIR) {
        const versionPath = path.join(filePath.toString(), "version.json");
        if (!fs.existsSync(versionPath)) {
            throw new FileNotFoundError(`Version information not found at ${versionPath}. Please run \`camoufox fetch\` to install.`);
        }
        const versionData = JSON.parse(fs.readFileSync(versionPath, "utf-8"));
        return new Version(versionData.release, versionData.version);
    }
    static isSupportedPath(path) {
        return Version.fromPath(path).isSupported();
    }
    static buildMinMax() {
        return [
            new Version(CONSTRAINTS.MIN_VERSION),
            new Version(CONSTRAINTS.MAX_VERSION),
        ];
    }
}
const [VERSION_MIN, VERSION_MAX] = Version.buildMinMax();
export class GitHubDownloader {
    githubRepo;
    apiUrl;
    constructor(githubRepo) {
        this.githubRepo = githubRepo;
        this.apiUrl = `https://api.github.com/repos/${githubRepo}/releases`;
    }
    checkAsset(asset) {
        return asset.browser_download_url;
    }
    missingAssetError() {
        throw new MissingRelease(`Could not find a release asset in ${this.githubRepo}.`);
    }
    async getAsset({ retries } = { retries: 5 }) {
        let attempts = 0;
        let response;
        while (attempts < retries) {
            try {
                response = await fetch(this.apiUrl);
                if (response.ok)
                    break;
            }
            catch (e) {
                console.error(e, `retrying (${attempts + 1}/${retries})...`);
                await setTimeout(5e3);
            }
            attempts++;
        }
        if (!response || !response.ok) {
            throw new Error(`Failed to fetch releases from ${this.apiUrl} after ${retries} attempts`);
        }
        const releases = await response.json();
        for (const release of releases) {
            for (const asset of release.assets) {
                const data = this.checkAsset(asset);
                if (data) {
                    return data;
                }
            }
        }
        this.missingAssetError();
    }
}
export class CamoufoxFetcher extends GitHubDownloader {
    arch;
    _version_obj;
    pattern;
    _url;
    constructor() {
        super("daijro/camoufox");
        this.arch = CamoufoxFetcher.getPlatformArch();
        this.pattern = new RegExp(`camoufox-(.+)-(.+)-${OS_NAME}\\.${this.arch}\\.zip`);
    }
    async init() {
        await this.fetchLatest();
    }
    checkAsset(asset) {
        const match = asset.name.match(this.pattern);
        if (!match)
            return null;
        const version = new Version(match[2], match[1]);
        if (!version.isSupported())
            return null;
        return [version, asset.browser_download_url];
    }
    missingAssetError() {
        throw new MissingRelease(`No matching release found for ${OS_NAME} ${this.arch} in the supported range: (${CONSTRAINTS.asRange()}). Please update the library.`);
    }
    static getPlatformArch() {
        const platArch = os.arch().toLowerCase();
        if (!(platArch in ARCH_MAP)) {
            throw new UnsupportedArchitecture(`Architecture ${platArch} is not supported`);
        }
        const arch = ARCH_MAP[platArch];
        if (!OS_ARCH_MATRIX[OS_NAME].includes(arch)) {
            throw new UnsupportedArchitecture(`Architecture ${arch} is not supported for ${OS_NAME}`);
        }
        return arch;
    }
    async fetchLatest() {
        if (this._version_obj)
            return;
        const releaseData = await this.getAsset();
        this._version_obj = releaseData[0];
        this._url = releaseData[1];
    }
    static async downloadFile(url) {
        const response = await fetch(url);
        return Buffer.from(await response.arrayBuffer());
    }
    async extractZip(zipFile) {
        const zip = new AdmZip(zipFile);
        zip.extractAllTo(INSTALL_DIR.toString(), true);
    }
    static cleanup() {
        if (fs.existsSync(INSTALL_DIR)) {
            fs.rmSync(INSTALL_DIR, { recursive: true });
            return true;
        }
        return false;
    }
    setVersion() {
        fs.writeFileSync(path.join(INSTALL_DIR.toString(), "version.json"), JSON.stringify({ version: this.version, release: this.release }));
    }
    async install() {
        await this.init();
        await CamoufoxFetcher.cleanup();
        try {
            fs.mkdirSync(INSTALL_DIR, { recursive: true });
            const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "camoufox-"));
            const tempFilePath = path.join(tempDir, "camoufox.zip");
            const tempFileStream = fs.createWriteStream(tempFilePath);
            await webdl(this.url, "Downloading Camoufox...", true, tempFileStream);
            await new Promise((r) => tempFileStream.close(r));
            await this.extractZip(tempFilePath);
            this.setVersion();
            if (OS_NAME !== "win") {
                execSync(`chmod -R 755 ${INSTALL_DIR}`);
            }
            console.log("Camoufox successfully installed.");
        }
        catch (e) {
            console.error(`Error installing Camoufox: ${e}`);
            await CamoufoxFetcher.cleanup();
            throw e;
        }
    }
    get url() {
        if (!this._url) {
            throw new Error("Url is not available. Make sure to run fetchLatest first.");
        }
        return this._url;
    }
    get version() {
        if (!this._version_obj || !this._version_obj.version) {
            throw new Error("Version is not available. Make sure to run fetchLatest first.");
        }
        return this._version_obj.version;
    }
    get release() {
        if (!this._version_obj) {
            throw new Error("Release information is not available. Make sure to run the installation first.");
        }
        return this._version_obj.release;
    }
    get verstr() {
        if (!this._version_obj) {
            throw new Error("Version is not available. Make sure to run the installation first.");
        }
        return this._version_obj.fullString;
    }
}
function userCacheDir(appName) {
    if (OS_NAME === "win") {
        return path.join(os.homedir(), "AppData", "Local", appName, appName, "Cache");
    }
    else if (OS_NAME === "mac") {
        return path.join(os.homedir(), "Library", "Caches", appName);
    }
    else {
        return path.join(os.homedir(), ".cache", appName);
    }
}
export function installedVerStr() {
    return Version.fromPath().fullString;
}
export function camoufoxPath(downloadIfMissing = true) {
    // Ensure the directory exists and is not empty
    if (!fs.existsSync(INSTALL_DIR) || fs.readdirSync(INSTALL_DIR).length === 0) {
        if (!downloadIfMissing) {
            throw new Error(`Camoufox executable not found at ${INSTALL_DIR}`);
        }
    }
    else if (fs.existsSync(INSTALL_DIR) &&
        Version.isSupportedPath(INSTALL_DIR)) {
        return INSTALL_DIR;
    }
    else {
        if (!downloadIfMissing) {
            throw new UnsupportedVersion("Camoufox executable is outdated.");
        }
    }
    // Install and recheck
    const fetcher = new CamoufoxFetcher();
    fetcher.install().then(() => camoufoxPath());
    return INSTALL_DIR;
}
export function getPath(file) {
    if (OS_NAME === "mac") {
        return path.resolve(camoufoxPath().toString(), "Camoufox.app", "Contents", "Resources", file);
    }
    return path.join(camoufoxPath().toString(), file);
}
export function launchPath() {
    const launchPath = getPath(LAUNCH_FILE[OS_NAME]);
    if (!fs.existsSync(launchPath)) {
        throw new CamoufoxNotInstalled(`Camoufox is not installed at ${camoufoxPath()}. Please run \`camoufox fetch\` to install.`);
    }
    return launchPath;
}
export async function webdl(url, desc = "", bar = true, buffer = null, { retries } = { retries: 5 }) {
    let attempts = 0;
    let response;
    while (attempts < retries) {
        try {
            response = await fetch(url);
            if (response.ok)
                break;
        }
        catch (e) {
            console.error(e, `retrying (${attempts + 1}/${retries})...`);
            await setTimeout(5e3);
        }
        attempts++;
    }
    if (!response || !response.ok) {
        throw new Error(`Failed to download from ${url} after ${retries} attempts`);
    }
    const totalSize = parseInt(response.headers.get("content-length") || "0", 10);
    const progressBar = bar
        ? new ProgressBar(`${desc} [:bar] :percent :etas`, {
            total: totalSize,
            width: 40,
        })
        : null;
    const chunks = [];
    for await (const chunk of response.body) {
        if (buffer) {
            buffer.write(chunk);
        }
        else {
            chunks.push(chunk);
        }
        if (progressBar) {
            progressBar.tick(chunk.length, "X");
        }
    }
    const fileBuffer = Buffer.concat(chunks);
    return fileBuffer;
}
export async function unzip(zipFile, extractPath, desc, bar = true) {
    const zip = new AdmZip(zipFile);
    const zipEntries = zip.getEntries();
    if (bar) {
        console.log(desc || "Extracting files...");
    }
    for (const entry of zipEntries) {
        if (bar) {
            console.log(`Extracting ${entry.entryName}`);
        }
        zip.extractEntryTo(entry, extractPath, false, true);
    }
    if (bar) {
        console.log("Extraction complete.");
    }
}
