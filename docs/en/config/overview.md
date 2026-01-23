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

  # Humanized Mouse Cursor Mode
  # - false:  Disable humanized cursor, use Playwright native click (Best performance, but easily detected by automation checks)
  # - true:   Use project-optimized ghost-cursor (More human-like, e.g., avoids clicking exact center, but slightly lower performance)
  # - "camou": Use Camoufox built-in cursor (Balance between performance and human-like behavior)
  humanizeCursor: true

  # Site Isolation (fission.autostart)
  # Keep enabled for standard Firefox behavior
  # Disabling this can significantly reduce memory usage and prevent crashes on low-end servers
  # ⚠️ Risk: Normal Firefox users have Fission enabled by default. While disabling it does not leak common fingerprints, 
  # extremely advanced anti-bot systems might identify automated features via "single-process model" or "IPC delays".
  fission: true

  # CSS Performance Injection
  # Reduce CPU load by disabling web effects (Best for CPU-only environments)
  cssInject:
    # Disable web animations
    # Effect: Removes transition and animation
    # Benefit: Significantly lowers continuous CPU usage
    # Risk: Very low. Almost no impact on browser fingerprint, but may cause layout issues on some webpages
    animation: false

    # Disable filters and shadows
    # Effect: Removes blur, box-shadow, etc.
    # Benefit: Prevents CPU spikes and lag in no-GPU environments
    # Risk: Medium. Interface aesthetics degraded, few anti-bots might detect style calculations
    filter: false

    # Reduce font rendering quality
    # Effect: Disables font anti-aliasing, forces fast rendering mode
    # Benefit: Slightly reduces CPU drawing pressure
    # ⚠️ Risk: High. Jagged text edges; font fingerprint differs from standard browsers (detected by advanced anti-bots)
    font: false
  
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
| `humanizeCursor` | boolean/string | `true` | Cursor mode: `true`, `false`, `"camou"`. |
| `proxy` | object | - | Global proxy configuration. |
| `cssInject` | object | - | CSS performance injection configuration. |

#### CSS Injection (cssInject)

Performance optimization options for CPU-Only environments. Reduces CPU load by disabling specific web effects via CSS injection.

| Item | Type | Default | Description |
| --- | --- | --- | --- |
| `animation` | boolean | `false` | **Disable Animations** (Recommended)<br>Effect: Removes transition and animation.<br>Benefit: Significantly reduces continuous CPU usage.<br>Risk: Very Low (Negligible impact on fingerprint). |
| `filter` | boolean | `false` | **Disable Effects**<br>Effect: Removes blur, box-shadow, etc.<br>Benefit: Prevents UI lag caused by complex rendering.<br>Risk: Medium (UI Aesthetics degraded, rarely checked by anti-bots). |
| `font` | boolean | `false` | **Fast Rendering Fonts**<br>Effect: Disables font anti-aliasing.<br>Benefit: Slightly reduces rendering pressure.<br>Risk: **High** (Font fingerprint anomaly, easily detected by advanced anti-bots). |

### Backend Resource Pool (backend.pool)

| Item | Type | Default | Description |
| --- | --- | --- | --- |
| `strategy` | string | `least_busy` | Load balancing strategy. Option: `least_busy`. |
| `failover.enabled` | boolean | `true` | Whether to enable automatic failover. |
| `failover.maxRetries` | number | `2` | Maximum retry attempts for failover. |
| `instances` | array | - | List of browser instances. See [Instances Configuration](/en/config/instances). |

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
