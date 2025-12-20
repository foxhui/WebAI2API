# Linux 部署

在 Linux 服务器上运行 WebAI2API 的特殊配置说明。

## 显示方式选择

在 Linux 服务器上运行非无头模式时，需要配置显示环境。

### 方式一：Xvfb + VNC (推荐)

使用虚拟显示器运行程序，通过 VNC 远程查看。

#### 使用内置命令

```bash
npm start -- -xvfb -vnc
```

这会自动：
- 启动 Xvfb 虚拟显示器
- 启动 x11vnc 服务器
- 可通过 WebUI 直接查看 VNC 画面

#### 手动配置

如果内置命令无法满足需求：

1. **启动虚拟显示器**

```bash
xvfb-run --server-num=99 --server-args="-ac -screen 0 1920x1080x24" npm start
```

2. **映射到 VNC**

```bash
x11vnc -display :99 -localhost -nopw -forever -noxdamage
```

## VNC 连接

### 通过 SSH 隧道 (推荐)

```bash
# 本地终端
ssh -L 5900:127.0.0.1:5900 root@服务器IP
```

然后使用 VNC 客户端连接 `127.0.0.1:5900`。

### 通过 WebUI

服务启动后，访问 WebUI 的「VNC 显示」页面即可直接查看。

### 安装依赖

### Ubuntu/Debian

```bash
sudo apt-get update
sudo apt-get install xvfb x11vnc
```

### CentOS/RHEL

```bash
sudo yum install xorg-x11-server-Xvfb x11vnc
```

### Arch Linux

```bash
sudo pacman -S xorg-server-xvfb x11vnc
```

### 方式二：X11 转发

适用于通过 SSH 连接服务器的场景。

1. 在本地安装 X Server（如 VcXsrv、Xming）
2. 使用支持 X11 转发的终端（如 WindTerm）
3. 在 SSH 会话中启用 X11 转发

```bash
ssh -X user@server
```

## Docker 部署

Docker 镜像已内置 Xvfb 和 VNC 支持：

```bash
docker run -d --name webai2api \
  -p 3000:3000 -p 5900:5900 \
  -v "$(pwd)/data:/app/data" \
  -e LOGIN_MODE=true \
  --shm-size=2gb \
  foxhui/lmarena-imagen-automator:latest
```

通过 VNC 客户端连接 `localhost:5900` 完成登录。

## 常见问题

### 端口被占用

如果 5900 端口已被占用，VNC 服务器会自动查找 5901-5999 范围内可用的端口。

### 显示号冲突

Xvfb 会自动从 50 开始查找可用的显示号，避免与现有 X 服务器冲突。
