# Linux 低内存优化建议

## 开启 SWAP

1. 检查当前的 SWAP 情况
   ```bash
   sudo swapon --show
   ```

2. 创建 SWAP 文件
   ```bash
   fallocate -l 4G /swapfile
   ```

3. 设置权限
   ```bash
   chmod 600 /swapfile
   ```

4. 格式化并启用 SWAP
   ```bash
   mkswap /swapfile
   swapon /swapfile
   ```

5. 设置开机自动挂载
   ```bash
   echo '/swapfile none swap sw 0 0' | tee -a /etc/fstab
   ```

## 开启 ZRAM

### Debian / Ubuntu

1. 安装
   ```bash
   apt update
   apt install zram-tools -y
   ```

2. 修改配置文件
   ```bash
   nano /etc/default/zramswap
   ```
   
   添加或修改以下内容：

   ```bash
   # 使用 lz4 压缩算法，速度和压缩率最平衡
   ALGO=lz4

   # 使用内存总量的 60% 作为 ZRAM 大小
   PERCENT=60

   # 【关键】设置优先级为 100。
   # 只要这个数字比磁盘 Swap（通常是 -2）大，系统就会优先用 ZRAM。
   PRIORITY=100
   ```

   按 `Ctrl+O` 回车保存，按 `Ctrl+X` 退出。

3. 重启服务
   ```bash
   systemctl daemon-reload
   systemctl restart zramswap
   ```

### CentOS / Arch Linux

这些系统推荐使用 `zram-generator`。

1. 安装
   ```bash
   # CentOS 8/9, Fedora, AlmaLinux, Rocky Linux
   dnf install zram-generator -y

   # Arch Linux
   pacman -S zram-generator
   ```

2. 修改配置文件
   创建或编辑 `/etc/systemd/zram-generator.conf`：

   ```ini
   [zram0]
   # 使用内存总量的 60%
   zram-size = ram * 0.6
   # 使用 lz4 压缩算法
   compression-algorithm = lz4
   # 优先级高于磁盘 Swap
   swap-priority = 100
   ```

3. 启动服务
   ```bash
   systemctl daemon-reload
   systemctl start systemd-zram-setup@zram0
   ```

### 通用优化

无论使用哪种系统，都建议调整 `swappiness` 以更积极地使用 ZRAM。

```bash
grep -q "vm.swappiness" /etc/sysctl.conf || echo "vm.swappiness=20" | tee -a /etc/sysctl.conf
sysctl -p
```

## 关闭站点隔离 (fission.autostart)

对于内存极度紧张（如 1GB 内存）的服务器，如果开启 SWAP 和 ZRAM 后仍然经常崩溃，可以作为**兜底方案**尝试关闭 Firefox 的站点隔离功能。

::: warning 风险提示
关闭站点隔离会降低浏览器的指纹独特性，可能导致更容易被高等级的反爬系统识别（如检测单进程模型或跨进程通信延迟）。请仅在必要时使用。
:::

1. 修改 `config.yaml` 配置文件：

   ```yaml
   browser:
     # ...
     # 关闭站点隔离以显著降低内存占用
     fission: false
   ```

2. 重启 WebAI2API 服务。

::: tip 提示
配置完成后，建议重启服务器以确保所有设置生效。
:::

