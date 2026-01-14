::: info
This English version is translated by **Gemini 3 Flash**.
:::

# Linux Low Memory Optimization

## Enable SWAP

1. Check current SWAP status
   ```bash
   sudo swapon --show
   ```

2. Create SWAP file
   ```bash
   fallocate -l 4G /swapfile
   ```

3. Set permissions
   ```bash
   chmod 600 /swapfile
   ```

4. Format and enable SWAP
   ```bash
   mkswap /swapfile
   swapon /swapfile
   ```

5. Set auto-mount on boot
   ```bash
   echo '/swapfile none swap sw 0 0' | tee -a /etc/fstab
   ```

## Enable ZRAM

### Debian / Ubuntu

1. Install
   ```bash
   apt update
   apt install zram-tools -y
   ```

2. Modify configuration file
   ```bash
   nano /etc/default/zramswap
   ```
   
   Add or modify the following:

   ```bash
   # Use lz4 compression algorithm for the best balance of speed and ratio
   ALGO=lz4

   # Use 60% of total memory as ZRAM size
   PERCENT=60

   # [Crucial] Set priority to 100.
   # As long as this is higher than disk Swap (usually -2), the system will prioritize ZRAM.
   PRIORITY=100
   ```

   Press `Ctrl+O` Enter to save, `Ctrl+X` to exit.

3. Restart service
   ```bash
   systemctl daemon-reload
   systemctl restart zramswap
   ```

### CentOS / Arch Linux

Recommended to use `zram-generator` for these systems.

1. Install
   ```bash
   # CentOS 8/9, Fedora, AlmaLinux, Rocky Linux
   dnf install zram-generator -y

   # Arch Linux
   pacman -S zram-generator
   ```

2. Modify configuration file
   Create or edit `/etc/systemd/zram-generator.conf`:

   ```ini
   [zram0]
   # Use 60% of total memory
   zram-size = ram * 0.6
   # Use lz4 compression algorithm
   compression-algorithm = lz4
   # Higher priority than disk Swap
   swap-priority = 100
   ```

3. Start service
   ```bash
   systemctl daemon-reload
   systemctl start systemd-zram-setup@zram0
   ```

### General Optimization

Regardless of the system, it is recommended to adjust `swappiness` to use ZRAM more aggressively.

```bash
grep -q "vm.swappiness" /etc/sysctl.conf || echo "vm.swappiness=20" | tee -a /etc/sysctl.conf
sysctl -p
```

## Disable Site Isolation (fission.autostart)

For servers with extremely tight memory (e.g., 1GB RAM), if the system still crashes frequently after enabling SWAP and ZRAM, you can try disabling Firefox's Site Isolation as a **last resort**.

::: warning Risk Disclosure
Disabling Site Isolation reduces the uniqueness of the browser fingerprint, potentially making it easier for high-level anti-bot systems to identify (e.g., by detecting single-process model or inter-process communication delays). Use only when necessary.
:::

1. Modify `config.yaml`:

   ```yaml
   browser:
     # ...
     # Disable site isolation to significantly reduce memory footprint
     fission: false
   ```

2. Restart WebAI2API service.

::: tip Tip
After completing the configuration, it is recommended to restart the server to ensure all settings take effect.
:::
