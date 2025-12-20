FROM node:22-bookworm

WORKDIR /app

ENV DEBIAN_FRONTEND=noninteractive
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=true

# 1. 安装系统依赖
RUN apt-get update && apt-get install -y \
    xvfb \
    x11vnc \
    libasound2 \
    libatk-bridge2.0-0 \
    libgtk-3-0 \
    libnss3 \
    libx11-xcb1 \
    libxss1 \
    libxtst6 \
    libgbm1 \
    libdbus-glib-1-2 \
    python3 \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# 2. 复制依赖文件、脚本和补丁目录，然后安装
COPY package.json pnpm-lock.yaml ./
COPY scripts/ ./scripts/
COPY patches/ ./patches/
RUN npm install -g pnpm && pnpm install --frozen-lockfile

# 3. 复制源码并初始化
COPY . .
RUN npm run init

# 4. 生成默认配置文件
RUN cp config.example.yaml config.yaml

EXPOSE 3000 5900

# 5. 启动脚本：同步 data 目录中的配置文件
CMD ["/bin/sh", "-c", "\
    if [ -f /app/data/config.yaml ]; then \
        cp /app/data/config.yaml /app/config.yaml; \
    else \
        mkdir -p /app/data; \
        cp /app/config.yaml /app/data/config.yaml; \
    fi; \
    npm start -- -xvfb -vnc \
"]