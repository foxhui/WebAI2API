# WebAI2API
![Image](https://github.com/user-attachments/assets/296a518e-c42b-4e39-8ff6-9b4381ed4f6e)

## 📝 项目简介

**WebAI2API** 是一个基于 **Camoufox (Playwright)** 的网页版 AI 服务转通用 API 的工具。通过模拟人类操作与 LMArena、Gemini 等网站交互，提供兼容 **OpenAI 格式** 的接口服务，同时支持 **多窗口并发** 与 **多账号管理**（浏览器实例数据隔离）。

### 📋 当前支持列表

| 网站名称 | 文本支持 | 图片支持 |
| :--- | :---: | :---: |
| [**LMArena**](https://lmarena.ai/) | ✅ | ✅ |
| [**Gemini Enterprise Business**](https://business.gemini.google/) | ✅ | ✅ |
| [**Nano Banana Free**](https://nanobananafree.ai/) | ❌ | ✅ |
| [**zAI**](https://zai.is/) | ❌ | ✅ |
| [**Google Gemini**](https://gemini.google.com/) | ❌ | ✅ |

> 未来可能会支持更多网站...

### ✨ 主要特性

- 🤖 **拟人交互**：模拟人类打字与鼠标轨迹，通过特征伪装规避自动化检测。
- 🔄 **接口兼容**：提供标准 OpenAI 格式接口，支持流式响应与心跳保活。
- 🚀 **并发隔离**：支持多窗口并发执行，可配置独立代理，实现多账号浏览器实例级数据隔离。
- 🛡️ **稳定防护**：内置任务队列、负载均衡、故障转移、错误重试等基础功能。

---

## 🚀 快速部署

本项目支持 **源码直接运行** 和 **Docker 容器化部署** 两种方式。

### 📋 环境要求
- **Node.js**: v20.0.0+ (ABI 115+)
- **操作系统**: Windows / Linux / macOS
- **核心依赖**: Camoufox (安装过程中自动获取)

### 🛠️ 方式一：手动部署

1. **安装与配置**
   ```bash
   # 1. 复制配置文件
   cp config.example.yaml config.yaml

   # 2. 安装依赖与初始化环境
   pnpm install
   npm run init  # ⚠️ 需确保网络能连接 GitHub
   ```

2. **启动服务**
   ```bash
   # 标准运行
   npm start

   # Linux 命令行启动
   npm start -- -xvfb -vnc
   ```

### 🐳 方式二：Docker 部署

> ⚠️ **特别说明**：登录相关操作可以在 WebUI 的虚拟显示器板块进行，也可通过 RealVNC 等工具连接（需添加映射 VNC 端口，默认非被占用的情况下为 5900）

**Docker CLI**
```bash
docker run -d --name webai-2api \
  -p 3000:3000 \
  -v "$(pwd)/data:/app/data" \
  --shm-size=2gb \
  foxhui/webai-2api:latest
```

**Docker Compose**
```bash
docker-compose up -d
```

---

## 📖 使用方法

### ⚠️ 首次使用必读

1. **完成初始化**：
   - Linux 用户使用 `npm start -- -xvfb -vnc` 启动程序，然后使用 WebUI 或者第三方工具连接 VNC
   - 手动登录账号
   - 在输入框发送任意消息，触发并完成 CloudFlare/reCAPTCHA 验证及服务条款同意
2. **运行建议**：
   - **WebUI 和 VNC 传输过程均未加密，若在公网环境运行请走 SSH 隧道或者使用 Caddy/Nginx 为 WebUI 添加 HTTPS 连接**
   ```bash
   # SSH隧道方法：在本地终端运行，将服务器 5900 端口映射到本地
   ssh -L 5900:127.0.0.1:5900 root@服务器IP
   ```
   - 初始化完成后可切换回标准模式，但为降低风控，**强烈建议长期保持非无头模式运行**

### 接口使用说明

> [!TIP]
> **详细文档**：请访问 [WebAI2API 文档中心](https://foxhui.github.io/WebAI2API/) 获取更全面的配置指南与接口说明。

#### 1. OpenAI 兼容接口

> [!WARNING]
> **并发限制与流式保活建议**
> 本项目通过模拟真实浏览器操作实现，处理过程根据实际情况时间可能有所变化，当积压的任务超过设置的数量时会直接拒绝非流式模式的请求。
> 
> **💡 强烈建议开启流式模式**：服务器将发送保活心跳包，可无限排队避免超时。

**请求端点**
```
POST http://127.0.0.1:3000/v1/chat/completions
```

#### 参数说明

| 参数 | 说明 |
| :--- | :--- |
| **model** | **必填**。指定使用的模型名称（如 `gemini-3-pro-image-preview`）。<br>可通过 `/v1/models` 接口获取支持的模型列表。 |
| **stream** | **推荐开启**。流式响应包含心跳保活机制，防止生成耗时过长导致连接超时。 |

> **💡 关于流式保活（Heartbeat）**
>
> 为防止长连接超时，系统提供两种保活模式（可在配置中切换）：
> 1. **Comment 模式（默认/推荐）**：发送 `:keepalive` 注释。符合 SSE 标准，兼容性最好。
> 2. **Content 模式**：发送空内容的 data 包。仅用于必须收到 JSON 数据才重置超时的特殊客户端。

#### 2. 获取可用模型列表

**请求端点**
```
GET http://127.0.0.1:3000/v1/models
```

#### 3. 获取 Cookies

**功能说明**：可利用本项目的自动续登功能获取最新 Cookie 给其他工具使用。

**请求端点**
支持使用 `name` 参数指定浏览器实例名称，`domain` 参数指定域名。
```
GET http://127.0.0.1:3000/v1/cookies (?name=browser_default&domain=lmarena.ai)
```

#### 4. 多模态请求 (图生图/文生图)

**功能说明**：支持在消息中附带图片进行对话或生成。

| 限制项 | 说明 |
| :--- | :--- |
| **支持格式** | PNG, JPEG, GIF, WebP |
| **数量限制** | 最大为10，但根据不同网站有不同出入 |
| **数据格式** | 必须使用 Base64 Data URL 格式 (如 `data:image/jpeg;base64,...`) |
| **自动转换** | 为保证兼容性与传输速度，服务器会自动将所有图片转换为 JPG 格式 |

---

## 📊 设备配置参考

| 资源 | 最低配置 | 推荐配置（单实例） | 推荐配置（多实例） |
| :--- | :--- | :--- | :--- |
| **CPU** | 1 核 | 2 核及以上 | 2 核及以上 |
| **内存** | 1 GB | 2 GB 及以上 | 4 GB 及以上 |
| **磁盘** | 2 GB 可用空间 | 5 GB 及以上 | 7 GB 及以上 |

**实测环境表现** (均为单浏览器实例)：
- **Oracle 免费机** (1C1G, Debian 12)：资源紧张，比较卡顿，仅供尝鲜或轻度使用
- **阿里云轻量云** (2C2G, Debian 11)：运行流畅，项目开发测试所用机型

## 📄 许可证和免责声明

本项目采用 [MIT License](LICENSE) 开源。

**免责声明**:
本项目仅供学习交流使用。如果因使用该项目造成的任何后果 (包括但不仅限于账号被禁用)，作者和该项目均不承担任何责任。请遵守相关网站和服务的使用条款 (ToS)，以及相关数据的备份工作。

---

## 📋 更新日志

查看完整的版本历史和更新内容，请访问 [CHANGELOG.md](CHANGELOG.md)。

## 🕰️ 历史版本说明

本项目已从 Puppeteer 迁移至 Camoufox，以应对日益复杂的反机器人检测机制。基于 Puppeteer 的旧版本代码已归档至 `puppeteer-edition` 分支，仅作留存，**不再提供更新与维护**。

---

**感谢 LMArena 、Gemini 等网站提供AI服务！** 🎉
