::: info
This English version is translated by **Gemini 3 Flash**.
:::

# First Use

When using WebAI2API for the first time, you need to complete the login initialization to use it normally.

## 1. Adjust Configuration File

The program will copy the configuration file from `config.example.yaml` to `data/config.yaml` upon its first run.

::: tip Tip
**Restarts are required for configuration changes to take effect!**
:::

```yaml
server:
  # Listening port
  port: 3000
  # Authentication API Token (Generate with: npm run genkey)
  # This setting affects both API endpoints and the WebUI
  auth: sk-change-me-to-your-secure-key
```

## 2. Access Web Management Interface

Once the service is started, open your browser and visit:
```
http://localhost:3000
```

::: tip Tip
**Remote Access**: Replace `localhost` with your server's IP address.
**API Token**: The `auth` key configured in the configuration file.
**Security Suggestion**: For public environments, use Nginx/Caddy with HTTPS or access via SSH tunnel.
:::

## 3. Initialize Account Login

> [!IMPORTANT]
> **The following initialization steps must be completed for first-time use**:

1. **Connect to Virtual Display**:
   - Linux/Docker: Connect via the "Virtual Display" section in the WebUI.
   - Windows: Operable directly in the popup browser window.

2. **Complete Account Login**:
   - Manually log in to the required AI website accounts (check account requirements in the WebUI Adapter Management).
   - Send an arbitrary message in the input box to trigger and complete human verification (if necessary).
   - Agree to terms of service or新手 (onboarding) guides (if necessary).
   - Ensure you are no longer blocked by any "first-time use" content.

3. **SSH Tunneling Example** (Recommended for public servers):
   ```bash
   # Run in your local terminal to map the server's WebUI locally
   ssh -L 3000:127.0.0.1:3000 root@Server_IP
   
   # Then access locally
   # WebUI: http://localhost:3000
   ```

::: tip Running Suggestions
To reduce the risk of being flagged, **we strongly recommend keeping non-headless mode enabled long-term** (or using Virtual Display Xvfb).

**Regarding Headful/Headless Mode**:
- **Headful Mode** (Default): Shows the browser window, useful for debugging and manual intervention.
- **Headless Mode**: Runs in the background, saves resources, but you cannot view the browser interface, and it may be more easily detected by some websites.
:::

## Login Mode

Login mode will force disable headless mode.

### Basic Usage
```bash
# Start the first Worker for login
npm start -- -login
```

### Multi-Worker Login

If you have configured multiple Workers, you need to complete the login for each one individually:

```bash
# Log in to each Worker sequentially
npm start -- -login=worker1
npm start -- -login=worker2
```

::: info Shared Login State
Multiple Workers under the same Instance (browser instance) share the login state. If using Unified Login like Google OAuth, you only need to log in once.
:::

### WebUI Login Mode

Once the service is running, you can also switch to login mode via the WebUI:

1. Visit http://localhost:3000
2. Go to the "System Management" page
3. Click the dropdown arrow on the "Restart" button
4. Select "Restart in Login Mode" or specify a specific Worker to log in.

## 4. Next Steps

Once the login is complete, please read the following:

- [Configuration Guide](/en/config/overview) - Learn more about all configuration options.
- [API Reference](/en/api/overview) - Start using the API.
