# 环境要求

在开始部署 WebAI2API 之前，请确保您的环境满足以下要求。

## 系统要求

### 操作系统

- **Windows**: Windows 10/11 或 Windows Server 2016+
- **Linux**: Ubuntu 18.04+, Debian 10+, CentOS 7+ 或其他主流发行版
- **macOS**: macOS 10.15 (Catalina) 或更高版本

### 硬件配置

| 资源 | 最低配置 | 推荐配置（单实例） | 推荐配置（多实例） |
| :--- | :--- | :--- | :--- |
| **CPU** | 1 核 | 2 核及以上 | 2 核及以上 |
| **内存** | 1 GB | 2 GB 及以上 | 4 GB 及以上 |
| **磁盘** | 2 GB 可用空间 | 5 GB 及以上 | 7 GB 及以上 |

::: tip 优化建议
对于内存为 1-2 GB 的低配服务器，强烈建议开启 **SWAP** 或 **ZRAM** 以提升系统稳定性并优化运行体验，操作方法请参考 [Linux 低内存优化](/admin/optimization)。
:::

::: tip 实测环境表现
- **Oracle 免费机** (1C1G, Debian 12)：资源紧张，比较卡顿，仅供尝鲜或轻度使用
- **阿里云轻量云** (2C2G, Debian 11)：运行流畅，项目开发测试所用机型
:::

## 软件依赖

### Node.js

- **版本要求**: v20.0.0 或更高版本 (ABI 115+)
- **包管理器**: pnpm (推荐) 或 npm

```bash
# 检查 Node.js 版本
node --version

# 安装 pnpm (如未安装)
npm install -g pnpm
```

### Camoufox

Camoufox 是本项目的核心依赖，会在安装过程中自动下载。

::: warning 网络要求
安装过程需要从 GitHub 下载 Camoufox 等预编译依赖，请确保网络能够正常访问 GitHub。
:::

## Docker 环境 (可选)

如果选择 Docker 部署方式，需要安装：

- **Docker**: 20.10.0 或更高版本
- **Docker Compose**: 2.0.0 或更高版本 (可选)

```bash
# 检查 Docker 版本
docker --version
docker compose version
```

## Linux 特殊依赖

在 Linux 环境下运行非无头模式时，可能需要额外安装：

```bash
# Ubuntu/Debian
sudo apt-get install xvfb x11vnc libgtk-3-0 libx11-xcb1 libasound2

# CentOS/RHEL
sudo yum install xorg-x11-server-Xvfb x11vnc gtk3 libX11-xcb alsa-lib

# Arch Linux
sudo pacman -S xorg-server-xvfb x11vnc gtk3 libx11 libxcb cairo alsa-lib
```

## 下一步

环境准备就绪后，请继续阅读 [快速部署](/guide/deployment) 开始安装。
