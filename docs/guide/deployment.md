# 快速部署

本项目支持 **手动部署（推荐）** 和 **Docker 容器化部署** 两种方式。

## 手动部署

### 1. 克隆项目

```bash
git clone https://github.com/foxhui/WebAI2API.git
cd WebAI2API
```

### 2. 复制配置文件

```bash
cp config.example.yaml config.yaml
```

### 3. 安装依赖

```bash
# 安装 Node.js 依赖
pnpm install

# 初始化预编译依赖
npm run init
```

::: warning 注意
`npm run init` 需要从 GitHub 下载文件，请确保网络畅通。
:::

### 4. 编辑配置

编辑 `config.yaml` 文件，设置鉴权密钥等配置：

```yaml
server:
  port: 3000
  auth: sk-your-secret-key  # 修改为你的密钥
```

### 5. 启动服务

```bash
# 标准运行
npm start

# Linux 命令行启动
npm start -- -xvfb -vnc
```

## Docker 部署

::: warning 首次运行说明
首次运行需通过 VNC 客户端连接 `localhost:5900` 完成网页登录验证。
:::

### Docker CLI

```bash
docker run -d --name webai2api \
  -p 3000:3000 -p 5900:5900 \
  -v "$(pwd)/data:/app/data" \
  -v "$(pwd)/config.yaml:/app/config.yaml" \
  -e LOGIN_MODE=true \
  --shm-size=2gb \
  foxhui/lmarena-imagen-automator:latest
```

### Docker Compose

```yaml
version: '3.8'
services:
  webai2api:
    image: foxhui/lmarena-imagen-automator:latest
    ports:
      - "3000:3000"
      - "5900:5900"
    volumes:
      - ./data:/app/data
      - ./config.yaml:/app/config.yaml
    environment:
      - LOGIN_MODE=true
    shm_size: 2gb
    restart: unless-stopped
```

启动服务：

```bash
docker compose up -d
```

## 验证安装

服务启动后，访问以下地址验证：

- **Web 管理界面**: http://localhost:3000
- **API 接口测试**: http://localhost:3000/v1/chat/completions

## 下一步

部署完成后，请阅读 [首次使用](/guide/first-use) 完成登录初始化。
