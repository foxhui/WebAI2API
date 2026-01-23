::: info
This English version is translated by **Gemini 3 Flash**.
:::

# Instance Configuration

Instance and Worker are the core configuration concepts of WebAI2API.

## Concepts

### Instance (Browser Instance)

An Instance represents an independent browser process with:
- Dedicated user data directory.
- Independent Cookies and login sessions.
- Optional exclusive proxy configuration.

### Worker

A Worker is a single tab within an Instance responsible for interacting with a specific platform. Multiple Workers under the same Instance:
- Share browser data and login states.
- Share proxy configuration.
- Can be of different adapter types.

## Configuration Structure

```yaml
backend:
  pool:
    instances:
      - name: "browser_default"    # Instance ID
        userDataMark: "01"         # Data directory identifier (Optional)
        proxy:                      # Instance-level proxy (Optional)
          enable: true
          type: socks5
          host: 127.0.0.1
          port: 1080
        workers:                    # List of Workers
          - name: "worker1"
            type: lmarena
          - name: "worker2"
            type: zai_is
```

## Instance Settings

| Setting | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | string | ✅ | Unique identifier for the instance, used in logs and Cookie retrieval. |
| `userDataMark` | string | ❌ | Data directory identifier. Leave empty to use the default directory. |
| `proxy` | object | ❌ | Instance-level proxy configuration. See [Proxy Settings](/en/config/proxy). |
| `workers` | array | ✅ | List of Worker configurations. |

### Data Directory

- Default Location: `data/camoufoxUserData`
- With `userDataMark`: `data/camoufoxUserData_{mark}`

## Worker Settings

| Setting | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | string | ✅ | Unique identifier for the Worker (must be globally unique). |
| `type` | string | ✅ | Adapter type. |
| `mergeTypes` | array | ❌ | List of adapter types for aggregation mode (required if type=merge). |
| `mergeMonitor` | string | ❌ | Backend to monitor while idle (Optional). |

### Adapter Types

| Type | Description |
| --- | --- |
| `lmarena` | LMArena Image Generation |
| `lmarena_text` | LMArena Text Generation |
| `gemini_biz` | Gemini Business Image & Video Generation |
| `gemini_biz_text` | Gemini Business Text Generation |
| `gemini` | Google Gemini Image & Video Generation |
| `gemini_text` | Google Gemini Text Generation |
| `zai_is` | zAI Image Generation |
| `zai_is_text` | zAI Text Generation |
| `nanobananafree_ai` | NanoBananaFree Image Generation |
| `zenmux_ai_text` | ZenMux Text Generation |
| `chatgpt` | ChatGPT Image Generation |
| `chatgpt_text` | ChatGPT Text Generation |
| `sora` | Sora Video Generation |
| `deepseek_text` | DeepSeek Text Generation |
| `doubao` | Doubao Image Generation |
| `doubao_text` | Doubao Text Generation |
| `test` | Browser Detection (For Debugging Only) |
| `merge` | Aggregation Mode (Multiple backends in a single tab) |

## Model Filter

Each adapter can be configured with its own model allowlist/blocklist to control the available models for that specific adapter.

### Configuration

The Model Filter is configured under `backend.adapter.<AdapterID>`:

```yaml
backend:
  adapter:
    lmarena:
      returnUrl: false
      modelFilter:
        mode: whitelist                        # whitelist or blacklist
        list:                                  # List of models to enable or disable
          - gemini-3-pro-image-preview
          - gemini-3-pro-image-preview-2k
          - gemini-2.5-flash-image-preview
```

### Settings

| Item | Type | Required | Description |
| --- | --- | --- | --- |
| `mode` | string | ✅ | Filter mode: `whitelist` or `blacklist`. |
| `list` | array | ✅ | List of Model IDs. |

### Filter Modes

- **whitelist**: Only models specified in the list are allowed; others will be filtered out.
- **blacklist**: Models specified in the list are disabled; others remain usable.

### Recommendations

::: tip Use WebUI for Configuration
We recommend using the Adapter Settings interface in the WebUI to configure model filters; visual operation is more convenient.
:::

::: warning Notes
- Model IDs must exactly match the IDs actually supported by the adapter.
- In whitelist mode, if the list is empty or there are no matching models, the adapter will be unusable.
- Model filter configurations for each adapter are independent.
:::

## Aggregation Mode (Merge)

Aggregation mode allows a single tab to support multiple backends, enabling failover:

```yaml
workers:
  - name: "merged_worker"
    type: merge
    mergeTypes: [gemini_biz, lmarena, zai_is]
    mergeMonitor: gemini_biz  # Backend to monitor while idle
```

::: tip Advantages of Aggregation Mode
- Saves browser resources.
- Automatic failover.
- Unified login state.
:::

## Configuration Examples

### Single Instance, Single Worker

```yaml
instances:
  - name: "default"
    workers:
      - name: "worker1"
        type: lmarena
```

### Multi-Instance Isolation

```yaml
instances:
  # Instance 1: US Proxy
  - name: "browser_us"
    userDataMark: "us"
    proxy:
      enable: true
      type: socks5
      host: us-proxy.example.com
      port: 1080
    workers:
      - name: "us_worker"
        type: lmarena

  # Instance 2: Japan Proxy
  - name: "browser_jp"
    userDataMark: "jp"
    proxy:
      enable: true
      type: socks5
      host: jp-proxy.example.com
      port: 1080
    workers:
      - name: "jp_worker"
        type: lmarena
```

### Aggregation Mode Example

```yaml
instances:
  - name: "browser_merged"
    workers:
      - name: "all_in_one"
        type: merge
        mergeTypes: [gemini_biz, lmarena, zai_is]
        mergeMonitor: gemini_biz
```
