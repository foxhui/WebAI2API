# 使用 Node.js 18 作为基础镜像
FROM node:18

# 设置工作目录
WORKDIR /app

# 安装 pnpm
RUN npm install -g pnpm

# 复制 package.json 和 pnpm-lock.yaml
COPY package.json pnpm-lock.yaml ./

# 安装依赖
RUN pnpm install

# 复制源代码
COPY . .

# 创建数据目录
RUN mkdir -p data

# 暴露端口（Hugging Face Spaces 使用 7860 端口）
EXPOSE 3000

# 设置环境变量
ENV NODE_ENV=production
ENV DOCKER_ENV=true

# 启动命令
CMD ["npm", "start"]