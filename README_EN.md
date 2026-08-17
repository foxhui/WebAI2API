# WebAI2API-Agent

[简体中文](README.md) | English

## Agent / Tool Calling edition

This repository is an Agent-ready fork of [foxhui/WebAI2API](https://github.com/foxhui/WebAI2API). It keeps the original browser adapters, browser pool, queue, WebUI, and legacy OpenAI-compatible chat path, while adding a compatibility layer for clients such as Codex and OpenClaw. The original author attribution and MIT license are retained.

The added layer preserves `tools`, `tool_choice`, `tool_calls`, `tool_call_id`, tool results, and cross-request Responses state. Requests are normalized into a Universal Agent IR, routed through a model-family strategy/parser, and converted back to standard Chat Completions or Responses objects. WebAI2API never executes shell, file, browser, or MCP tools; the Agent client remains responsible for execution, authorization, and sandboxing.

### Implemented

- `POST /v1/chat/completions` with `tools`, `tool_choice`, `parallel_tool_calls`, assistant `tool_calls`, and `role: tool`.
- Minimal `POST /v1/responses` with `function_call`, `function_call_output`, `call_id`, `previous_response_id`, and bounded in-memory state.
- Shared Universal Agent IR, JSON Schema/state validation, call IDs, multi-turn tool results, and strategy/parser registries.
- OpenAI-like, Qwen Hermes, Qwen3-Coder, Gemini-like, Anthropic-like, and generic tagged JSON strategies. Native pass-through is an extension point, not a blanket claim of native support.
- Buffered Agent SSE conversion: complete web output is collected and validated before a stable protocol event is emitted.
- Agent mode is disabled by default; ordinary chat remains on the legacy path.

### Verification boundary

| Level | Evidence |
| --- | --- |
| Verified | `npm test` 46/46, including legacy chat, Chat Agent, Responses, SSE, queue, and parser fixtures |
| Verified | Standalone Codex CLI loop through the production port 3000: real failing test, read, edit, retest, with `CODEX_PRODUCTION_3000_OK` on successful runs |
| Verified | Isolated OpenClaw profile/workspace loop with six real `exec`/`read`/`edit` calls and a successful repair; this is Canary evidence, not a claim about every production account |
| Verified web path | The real loops used the ChatGPT web adapter; `gpt-instant` and `gpt-thinking` were used in the recorded runs |
| Theory/code-level only | Qwen, Gemini, Anthropic strategies and other OpenAI-compatible Agent clients |
| Not verified | Claude Code, real Qwen/Gemini/Claude web tool loops, every inherited adapter in Agent mode, and parallel execution |

Protocol fixtures are not evidence that every web account has passed an Agent loop. Use `GET /v1/models` and verify tool calls, tool results, and side effects on your own deployment.

### Enable Agent mode

```yaml
agentCompatibility:
  enabled: true
  nativePassThrough: false
  temporaryChat: true
  forceInitialToolChoice: false
  forceSyntheticToolChoiceTurns: 0
  maxSyntheticToolRetries: 1
  retrySyntheticAutoFinal: false
  maxSyntheticInstructionChars: 12000
```

### Quick start and client endpoints

```bash
git clone https://github.com/passionsugar/WebAI2API.git
cd WebAI2API
corepack enable
pnpm install
npm run init
npm run genkey
npm start -- -xvfb -vnc
```

If pnpm 11 reports `ERR_PNPM_IGNORED_BUILDS`, approve the two native build scripts and rerun the install: `pnpm approve-builds better-sqlite3 sharp`, then `pnpm install`.

The first start creates `data/config.yaml` from `config.example.yaml`; put the generated key into `server.auth`. Point Codex's Responses provider at `http://127.0.0.1:3000/v1` with `wire_api = "responses"`. Configure OpenClaw's OpenAI-compatible provider with the same base URL, an environment-injected key, and a model returned by `/v1/models`; exact config keys vary by OpenClaw version.

The current `docker-compose.yaml` still uses the upstream `foxhui/webai-2api:latest` image. Build the local `Dockerfile` if you need the Agent code.

### Limitations

Synthetic tool calling is prompt/parser compatibility, not native function calling. Web DOM/SSE changes, model behavior, account limits, and login state can affect it. Agent SSE is buffered, Responses state is in-process memory, and WebAI2API never executes client tools. Claude Code, real Qwen/Gemini/Claude web loops, and other clients remain unverified.

See [AGENT_COMPATIBILITY_TUTORIAL.md](AGENT_COMPATIBILITY_TUTORIAL.md) for architecture details and [AGENT_ACCEPTANCE_20260816.md](AGENT_ACCEPTANCE_20260816.md) for the evidence boundary.

<p align="center">
  <img src="https://github.com/user-attachments/assets/296a518e-c42b-4e39-8ff6-9b4381ed4f6e" width="49%" />
  <img src="https://github.com/user-attachments/assets/bfa30ece-6947-4f18-b2c9-ccc8087b7e89" width="49%" />
</p>
<p align="center">
  <img src="https://github.com/user-attachments/assets/5b15ebd2-7593-4f0e-8561-83d6ba5d88ab" width="49%" />
  <img src="https://github.com/user-attachments/assets/53deea29-4071-4a07-8a61-211761c5f2f7" width="49%" />
</p>

## 📑 Table of Contents

- [Quick Deployment](#-quick-deployment)
- [Quick Start](#-quick-start)
- [Usage](#-usage)
- [API Reference](#-api-reference)
- [Hardware Configuration Reference](#-hardware-configuration-reference)

---

## 📝 Project Introduction

**WebAI2API** is a tool that converts web-based AI services into general APIs based on **Camoufox (Playwright)**. It interacts with websites like LMArena and Gemini by simulating human operations, providing interfaces compatible with the **OpenAI format**, while supporting **multi-window concurrency** and **multi-account management** (browser instance data isolation).

### ✨ Key Features

- 🤖 **Human-like Interaction**: Simulates human typing and mouse trajectories, evading automation detection through feature camouflage.
- 🔄 **API Compatibility**: Provides standard OpenAI format interfaces, supporting streaming responses and heartbeat persistence.
- 🚀 **Concurrency & Isolation**: Supports multi-window concurrent execution with independent proxy configurations, achieving browser-level data isolation for multiple accounts.
- 🛡️ **Stable Protection**: Built-in task queue, load balancing, failover, error retry, and other essential functions.
- 🎨 **Web Management**: Provides a visual management interface supporting real-time log viewing, VNC connection, adapter management, etc.

### 📋 Supported Platforms

| Website | Text Gen | Image Gen | Video Gen |
| :--- | :---: | :---: | :---: | 
| [**LMArena**](https://lmarena.ai/) | ✅ | ✅ | 🚫 |
| [**Gemini Enterprise Business**](https://business.gemini.google/) | ✅ | ✅ | ✅ |
| [**Nano Banana Free**](https://nanobananafree.ai/) | 🚫 | ✅ | 🚫 |
| [**zAI**](https://zai.is/) | ✅ | ✅ | 🚫 |
| [**Google Gemini**](https://gemini.google.com/) | ✅ | ✅💧 | ✅💧 | 
| [**ZenMux**](https://zenmux.ai/) | ✅ | ❌ | 🚫 | 
| [**ChatGPT**](https://chatgpt.com/) | ✅ | ✅ | 🚫 | 
| [**DeepSeek**](https://chat.deepseek.com/) | ✅ | 🚫 | 🚫 | 
| [**Sora**](https://sora.chatgpt.com/) | 🚫 | 🚫 | ✅💧 | 
| [**Google Flow**](https://labs.google/fx/zh/tools/flow) | 🚫 | ✅ | ❌ | 
| [**Doubao**](https://www.doubao.com/) | ✅ | ✅ | ❌ | 
| To be continued... | - | - | - | 

> [!NOTE]
> **Get full model list**: Use the `GET /v1/models` endpoint to view all available models and their details under the current configuration.
> 
> ✅ Supported; ❌ Not currently supported, but may be in the future; 🚫 Website does not support, future support depends on the website's status; 💧 Results contain watermarks that cannot be removed.

---

## 🚀 Quick Deployment

This project supports both **source code execution** and **Docker containerized deployment**.

### 📋 Environment Requirements

- **Node.js**: v20.0.0+ (ABI 115+)
- **OS**: Windows / Linux / macOS
- **Core Dependency**: Camoufox (automatically downloaded during installation)

### 🛠️ Method 1: Manual Deployment

1. **Installation & Configuration**
   ```bash
   # 1. Install NPM dependencies
   pnpm install

   # 2. Install precompiled dependencies like the browser
   # ⚠️ This script requires connecting to GitHub to download resources. Use a proxy if network access is limited.
   npm run init 
   # Using a proxy
   # Use -proxy to interactively input proxy configuration
   npm run init -- -proxy=http://username:passwd@host:port

   # 3. Linux Dependencies
   # For other distributions, please check the documentation center or search online.
   apt install -y xvfb x11vnc libgtk-3-0 libx11-xcb1 libasound2

   ```

2. **Start Service**
   ```bash
   # Standard start
   npm start

   # Linux - Start with virtual display
   npm start -- -xvfb -vnc

   # Login mode (Temporarily forces disabling headless mode and automation)
   npm start -- -login (-xvfb -vnc)
   ```

### 🐳 Method 2: Docker Deployment

> [!WARNING]
> **Security Reminder**: 
> - The Docker image enables the virtual display (Xvfb) and VNC service by default.
> - Connection is possible via the virtual display section of the WebUI.
> - **WebUI transmission is unencrypted. Please use SSH tunneling or HTTPS in public network environments.**

**Start with Docker CLI**
```bash
docker run -d --name webai-2api \
  -p 3000:3000 \
  -v "$(pwd)/data:/app/data" \
  --shm-size=2gb \
  foxhui/webai-2api:latest
```

**Start with Docker Compose**
```bash
docker-compose up -d
```

---

## ⚡ Quick Start

### 1. Adjust Configuration File

On first run, the program will copy the configuration file from `config.example.yaml` to `data/config.yaml`.

**Changes to the configuration file require a program restart to take effect!**

```yaml
server:
  # Listening port
  port: 3000
  # Authentication API Token (can be generated using npm run genkey)
  # This configuration applies to both API endpoints and the WebUI
  auth: sk-change-me-to-your-secure-key
```

> [!TIP]
> **Full Configuration Details**: Please refer to the detailed comments in [config.example.yaml](config.example.yaml), or visit the [WebAI2API Documentation Center](https://foxhui.github.io/WebAI2API/en/) for a complete configuration guide.

### 2. Access Web Management Interface

After the service starts, open your browser and visit:
```
http://localhost:3000
```

> [!TIP]
> **Remote Access**: Replace `localhost` with your server's IP address.
> **API Token**: The authentication key configured in `auth` of the configuration file.
> **Security Suggestion**: For public network environments, it is recommended to configure HTTPS using Nginx/Caddy or access via SSH tunnel.

### 3. Initial Account Login

> [!IMPORTANT]
> **The following initialization steps must be completed on first use**:

1. **Connect to Virtual Display**:
   - Linux/Docker: Connect in the "Virtual Display" section of the WebUI.
   - Windows: Operate directly in the browser window that pops up.

2. **Complete Account Login**:
   - Manually log in to the required AI website account (account requirements can be found in the WebUI's adapter management).
   - Send any message in the input box to trigger and complete human-machine verification (if required).
   - Agree to terms of service or新手 guides (if required).
   - Ensure there are no more initial use related obstructions.

3. **SSH Tunnel Connection Example** (Recommended for public servers):
   ```bash
   # Run in your local terminal to map the server's WebUI to local
   ssh -L 3000:127.0.0.1:3000 root@Server_IP
   
   # Then access locally
   # WebUI: http://localhost:3000
   ```

---

## 📖 Usage

### Running Mode Description

> [!NOTE]
> **Regarding Headful/Headless Mode**:
> - **Headful Mode** (Default): Displays the browser window, convenient for debugging and manual intervention.
> - **Headless Mode**: Runs in the background, saves resources but interfaces cannot be viewed, and may be detected by websites.
> 
> **Recommendation**: To reduce risk, **it is strongly recommended to run in non-headless mode for the long term** (or use virtual display Xvfb).

---

## 🔌 API Reference

> [!TIP]
> **Detailed Documentation**: Please visit the [WebAI2API Documentation Center](https://foxhui.github.io/WebAI2API/en/) for a more comprehensive configuration guide and interface description.

### 1. OpenAI Compatible API

> [!WARNING]
> **Concurrency Limits and Streaming Keep-alive Recommendations**
> 
> This project is implemented by simulating real browser operations, and processing time may vary. When the backlog of tasks exceeds the configured amount, non-streaming requests will be rejected directly.
> 
> **💡 Highly Recommended to enable Streaming Mode**: The server will send keep-alive heartbeat packets, allowing for infinite queuing to avoid timeouts.

#### Text Chat

**Endpoint**: `POST /v1/chat/completions`

**Request Example**:
```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "model": "gemini-3-pro",
    "messages": [
      {"role": "user", "content": "Hello, please introduce yourself"}
    ],
    "stream": true
  }'
```

#### Multimodal Requests (Text-to-Image / Image-to-Image)

**Supported Image Formats**:
- **Formats**: PNG, JPEG, GIF, WebP
- **Quantity**: Max 10 images (specific limits vary by website)
- **Data Format**: Must use Base64 Data URL format
- **Auto Conversion**: The server automatically converts all images to JPG to ensure compatibility.

#### Parameter Description

| Parameter | Type | Required | Description |
| :--- | :--- | :---: | :--- |
| `model` | string | ✅ | Model name, available list can be retrieved via `/v1/models` |
| `stream` | boolean | Rec. | Whether to enable streaming response, includes heartbeat keep-alive mechanism |

> [!NOTE]
> **Regarding Streaming Keep-alive (Heartbeat)**
>
> To prevent long connection timeouts, the system provides two keep-alive modes (configurable):
> 1. **Comment Mode (Default/Recommended)**: Sends `:keepalive` comments, compliant with SSE standards, best compatibility.
> 2. **Content Mode**: Sends data packets with empty content, only for special clients that must receive JSON data to reset timeouts.

### 2. Get Model List

**Endpoint**: `GET /v1/models`

**Request Example**:
```bash
curl http://localhost:3000/v1/models \
  -H "Authorization: Bearer YOUR_API_KEY"
```

### 3. Get Cookies

**Description**: Utilize the project's automatic renewal feature to get the latest Cookies for use with other tools.

**Endpoint**: `GET /v1/cookies`

**Parameters**:
- `name` (Optional): Browser instance name, defaults to `default`.
- `domain` (Optional): Filter Cookies for a specific domain.

**Request Example**:
```bash
# Get cookies for a specific instance and domain
curl "http://localhost:3000/v1/cookies?name=browser_default&domain=lmarena.ai" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

---

## 📊 Hardware Configuration Reference

| Resource | Minimum | Recommended (Single Instance) | Recommended (Multi-Instance) |
| :--- | :--- | :--- | :--- |
| **CPU** | 1 Core | 2 Cores+ | 2 Cores+ |
| **RAM** | 1 GB | 2 GB+ | 4 GB+ |
| **Disk** | 2 GB available | 5 GB+ | 7 GB+ |

**Measured Environment Performance** (All with single browser instance):
- **Oracle Free Tier** (1C1G, Debian 12): Resource-intensive, quite laggy, only for trial or light use.
- **Aliyun Lightweight Cloud** (2C2G, Debian 11): Runs smoothly but instances may still lag; used for project development and testing.

---

## 📄 License and Disclaimer

This project is open-sourced under the [MIT License](LICENSE).

> [!CAUTION]
> **Disclaimer**
> 
> This project is for educational and exchange purposes only. The author and the project are not responsible for any consequences (including but not limited to account suspension) caused by using this project. Please comply with the Terms of Service (ToS) of the relevant websites and services, and ensure proper backup of relevant data.

---

## 📋 Changelog

View the full version history and update details at [CHANGELOG.md](CHANGELOG.md).

### 🕰️ Historical Version Note

This project has migrated from Puppeteer to Camoufox to handle increasingly complex anti-bot detection mechanisms. Older code based on Puppeteer has been archived to the `puppeteer-edition` branch for reference only and is **no longer updated or maintained**.

---

**Thanks to sites like LMArena and Gemini for providing AI services!** 🎉
