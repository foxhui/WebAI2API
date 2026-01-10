::: info
This English version is translated by **Gemini 3 Flash**.
:::

# Requirements

Before you start deploying WebAI2API, please ensure that your environment meets the following requirements.

## System Requirements

### Operating System

- **Windows**: Windows 10/11 or Windows Server 2016+
- **Linux**: Ubuntu 18.04+, Debian 10+, CentOS 7+, or other mainstream distributions
- **macOS**: macOS 10.15 (Catalina) or higher

### Hardware Configuration

| Resource | Minimum | Recommended (Single Instance) | Recommended (Multi-Instance) |
| :--- | :--- | :--- | :--- |
| **CPU** | 1 Core | 2 Cores or above | 2 Cores or above |
| **Memory** | 1 GB | 2 GB or above | 4 GB or above |
| **Disk** | 2 GB available | 5 GB or above | 7 GB or above |

::: tip Real-world Performance
- **Oracle Free Tier** (1C1G, Debian 12): Limited resources, can be laggy, suitable for testing or light use only.
- **Alibaba Cloud Lightweight** (2C2G, Debian 11): Runs smoothly, used for project development and testing.
:::

## Software Dependencies

### Node.js

- **Version Requirement**: v20.0.0 or higher (ABI 115+)
- **Package Manager**: pnpm (recommended) or npm

```bash
# Check Node.js version
node --version

# Install pnpm (if not installed)
npm install -g pnpm
```

### Camoufox

Camoufox is the core dependency of this project and will be downloaded automatically during the installation process.

::: warning Network Requirements
The installation process requires downloading pre-compiled dependencies like Camoufox from GitHub. Please ensure your network has access to GitHub.
:::

## Docker Environment (Optional)

If you choose to deploy via Docker, you need to install:

- **Docker**: 20.10.0 or higher
- **Docker Compose**: 2.0.0 or higher (optional)

```bash
# Check Docker version
docker --version
docker compose version
```

## Linux Specific Dependencies

When running in non-headless mode on Linux, you may need to install additional packages:

```bash
# Ubuntu/Debian
sudo apt-get install xvfb x11vnc

# CentOS/RHEL
sudo yum install xorg-x11-server-Xvfb x11vnc

# Arch Linux
sudo pacman -S xorg-server-xvfb x11vnc
```

## Next Steps

Once your environment is ready, please proceed to [Quick Deployment](/en/guide/deployment) to start the installation.
