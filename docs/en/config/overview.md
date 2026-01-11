::: info
This English version is translated by **Gemini 3 Flash**.
:::

# Configuration Overview

WebAI2API uses a YAML format configuration file `config.yaml`.

::: warning Note
The project configuration can now be fully managed via the WebUI. If you are not familiar with YAML files, please skip this section and use the WebUI to modify settings!
:::

## Configuration Structure

```yaml
# Log Level
logLevel: info

# Server Configuration
server:
  port: 3000
  auth: sk-your-key
  keepalive:
    mode: "comment"

# Backend Configuration
backend:
  pool:
    strategy: least_busy
    failover:
      enabled: true
      maxRetries: 2
    instances:
      - name: "browser_default"
        workers:
          - name: "default"
            type: lmarena
  adapter:
    gemini_biz:
      entryUrl: ""

# Queue Configuration
queue:
  queueBuffer: 2
  imageLimit: 5

# Browser Configuration
browser:
  # Path to browser executable (leave empty for default)
  # Modification is not recommended unless necessary, as you may need to handle extra dependencies
  # Windows example: "C:\\camoufox\\camoufox.exe"
  # Linux example: "/opt/camoufox/camoufox"
  path: ""
  
  # Whether to enable headless mode
  headless: false

  # Site Isolation (fission.autostart)
  # Keep enabled for standard Firefox behavior
  # Disabling this can significantly reduce memory usage and prevent crashes on low-end servers
  # ⚠️ Risk: Normal Firefox users have Fission enabled by default. While disabling it does not leak common fingerprints, 
  # extremely advanced anti-bot systems might identify automated features via "single-process model" or "IPC delays".
  fission: true
  
  # [Global Proxy] Used if an Instance does not have its own proxy configuration
  proxy:
    # Whether to enable proxy
    enable: false
    # Proxy type: http or socks5
    type: http
    # Proxy host
    host: 127.0.0.1
    # Proxy port
    port: 7890
    # Proxy authentication (optional)
    # user: username
    # passwd: password
```

## Configuration Items

### Logging

| Item | Type | Default | Description |
| --- | --- | --- | --- |
| `logLevel` | string | `info` | Log visibility levels: `debug`, `info`, `warn`, `error` |

### Server (server)

| Item | Type | Default | Description |
| --- | --- | --- | --- |
| `port` | number | `3000` | HTTP service listening port |
| `auth` | string | - | API Authentication Token (Bearer Token) |
| `keepalive.mode` | string | `comment` | Keep-alive mode: `comment` or `content` |

::: tip Keep-alive Mode
- **comment**: Sends a `:keepalive` comment. Does not pollute the data stream (recommended).
- **content**: Sends an empty delta. Useful for clients that reset timeouts only upon receiving valid JSON.
:::

### Queue (queue)

| Item | Type | Default | Description |
| --- | --- | --- | --- |
| `queueBuffer` | number | `2` | Extra queuing slots for non-streaming requests. 0 means unlimited. |
| `imageLimit` | number | `5` | Maximum number of images per request (Max 10). |

### Browser (browser)

| Item | Type | Default | Description |
| --- | --- | --- | --- |
| `path` | string | `""` | Path to Camoufox executable. Leave empty to use default. |
| `headless` | boolean | `false` | Whether to enable headless mode. |
| `fission` | boolean | `true` | Whether to enable Site Isolation (fission.autostart). |
| `proxy` | object | - | Global proxy configuration. |

### Adapter Configuration (backend.adapter)

Each adapter can be configured with its own model allowlist/blocklist to control the available models for that specific adapter.

| Item | Type | Default | Description |
| --- | --- | --- | --- |
| `modelFilter.mode` | string | - | Filter mode: `whitelist` or `blacklist`. |
| `modelFilter.list` | array | - | List of models (to be enabled or disabled based on `mode`). |

::: tip Model Filtering
- **whitelist (Allowlist)**: Only models in the list are permitted.
- **blacklist (Blocklist)**: Models in the list are disabled; others are available.
- Using the WebUI for configuration is recommended.
:::

Configuration Example:

```yaml
backend:
  adapter:
    lmarena:
      returnUrl: false
      modelFilter:
        mode: whitelist                        # Allowlist mode
        list:                                  # Only enable the following models
          - gemini-3-pro-image-preview
          - gemini-3-pro-image-preview-2k
          - gemini-2.5-flash-image-preview
```

## Related Documents

- [Instances Configuration](/en/config/instances) - Detailed browser instance and Worker configuration.
- [Proxy Settings](/en/config/proxy) - Detailed proxy setup.
