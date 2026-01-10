::: info
This English version is translated by **Gemini 3 Flash**.
:::

# Web Management Interface

WebAI2API provides a built-in Web Management Interface (WebUI) for monitoring and managing the service.

::: warning Note
The WebUI and management interfaces only use the API Token for authentication during the handshake phase. Transmissions are not encrypted. If you are using this on a public network, please use a professional web server like Caddy or Nginx to provide HTTPS encryption!
:::

## Access URL

```
http://localhost:3000
```

On your first visit, you will need to enter the API Token set in your configuration file (`auth` field) for authentication.

## Functional Modules

### Dashboard

The dashboard displays the system's operational status:

- **System Status**: Version, uptime, and running mode.
- **Business Statistics**: Number of windows and instances.
- **Queue Status**: Lists of tasks currently being processed or waiting in the queue.

### System Management

The system management page provides:

- **Service Control**
  - Normal Restart
  - Restart in Login Mode
  - Specific Worker Login
  - Stop Service
  - Adapter Settings (descriptions, model management, feature toggles)

- **Cache Management**
  - View temporary files.
  - Clear cache.

- **Data Management**
  - View browser data directories.
  - Delete unused data directories.

### VNC Display

When starting with `-xvfb -vnc` in a Linux environment, you can view and operate the virtual display directly through the WebUI:

- Connect/Disconnect VNC.
- Full-screen mode.
- View VNC status information.

::: tip Note
The VNC display feature requires the service to be running in Xvfb + VNC mode.
:::

### Configuration Management

- **Server Configuration**: Port, authentication, and heartbeat settings.
- **Adapter Configuration**: Exclusive settings for each backend.
- **Browser Settings**: Path, headless mode, and proxy settings.

### Instance Management

Manage browser instance and Worker configurations (requires a restart to take effect).

## Quick Actions

### Restarting in Login Mode

1. Go to the "Cache & Restart" page.
2. Click the dropdown arrow next to the "Restart" button.
3. Select the restart mode:
   - **Normal Restart**: Restarts in standard mode.
   - **Login Mode Restart**: Restarts with the `-login` parameter.
   - **Specific Worker Login**: Select a specific Worker to enter login mode.

### Clearing Cache

1. Go to the "Cache & Restart" page.
2. Find the "Cache Management" area.
3. Click the "Clear Cache" button.
