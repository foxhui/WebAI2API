::: info
This English version is translated by **Gemini 3 Flash**.
:::

# Quick Deployment

This project supports **Manual Deployment (Recommended)** and **Docker Containerization Deployment**.

## Manual Deployment

### 1. Clone the Project

```bash
git clone https://github.com/foxhui/WebAI2API.git
cd WebAI2API
```

### 2. Install Dependencies

```bash
# 1. Install NPM dependencies
pnpm install
# 2. Install browser and other pre-compiled dependencies
npm run init 
# Use a proxy
# Use -proxy to interactively input proxy configuration
npm run init -- -proxy=http://username:passwd@host:port
```

::: warning Note
`npm run init` needs to download files from GitHub. Please ensure your network is connected.
:::

### 3. Start the Service

```bash
# Standard Start
npm start
# Linux System - Start with Virtual Display
npm start -- -xvfb -vnc
# Login Mode (Temporarily disables headless mode and automation)
npm start -- -login (-xvfb -vnc)
```

## Docker Deployment

::: warning **Security Alert**
- Docker images have Virtual Display (Xvfb) and VNC service enabled by default.
- You can connect through the Virtual Display section of the WebUI.
- **WebUI transmissions are not encrypted. For public network environments, please use SSH tunneling or HTTPS.**
:::

### Docker CLI

```bash
docker run -d --name webai-2api \
  -p 3000:3000 \
  -v "$(pwd)/data:/app/data" \
  --shm-size=2gb \
  foxhui/webai-2api:latest
```

### Docker Compose

```yaml
services:
  webai-2api:
    image: foxhui/webai-2api:latest
    container_name: webai-2api
    restart: unless-stopped
    ports:
      - "3000:3000"
    volumes:
      - ./data:/app/data
    shm_size: '2gb'
    init: true
```

Start the service:

```bash
docker compose up -d
```

## Verify Installation

After the service starts, visit the following URLs for verification:

- **Web Management Interface**: http://localhost:3000
- **API Interface Test**: http://localhost:3000/v1/chat/completions

## Next Steps

Once deployment is complete, please read [First Use](/en/guide/first-use) to complete login initialization.
