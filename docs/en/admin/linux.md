::: info
This English version is translated by **Gemini 3 Flash**.
:::

# Linux Deployment

[Docker users can ignore this] Special configuration instructions for running WebAI2API on Linux servers.

## 1. Install Necessary Dependencies

Essential dependencies for Linux command-line mode that allow you to run graphical applications in a Linux environment without a desktop environment.

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

## 2. Run the Program

Run the program using a virtual display and view it remotely via VNC. (The program will handle all the setup for you.)

```bash
npm start -- -xvfb -vnc
```

This will automatically:
- Start the Xvfb virtual display.
- Start the x11vnc server.
- Allow you to view the VNC screen directly through the WebUI.

## 3. Connecting to the Program

### Via WebUI (Recommended)

Once the service is started, visit the "VNC Display" page in the WebUI to view it directly.

### Via SSH Tunnel

::: tip Tip
The port might not always be 5900; the program will automatically search for an available VNC port in the range 5900-5999.
:::

```bash
# In your local terminal
ssh -L 5900:127.0.0.1:5900 root@Server_IP
```

Then use a VNC client to connect to `127.0.0.1:5900`.

## Alternative Method: Terminal X11 Forwarding

This method is not recommended unless you prefer to configure your own environment.

1. Install an X Server locally (e.g., VcXsrv, Xming).
2. Use a terminal that supports X11 forwarding (e.g., WindTerm).
3. Enable X11 forwarding in your SSH session.

```bash
ssh -X user@server
```

## FAQ

### Port Already Occupied

If port 5900 is already in use, the VNC server will automatically look for an available port in the 5901-5999 range.

### Display Number Conflict

Xvfb will automatically search for an available display number starting from 50 to avoid conflicts with existing X servers.

### Unable to Connect to VNC

Please check if the dependencies were installed successfully.
