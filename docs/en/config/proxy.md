::: info
This English version is translated by **Gemini 3 Flash**.
:::

# Proxy Settings

WebAI2API supports global proxy and instance-level proxy configurations.

## Proxy Priority

1. **Instance-level Proxy**: If an Instance is configured with its own proxy, that proxy is used.
2. **Global Proxy**: If the instance is not configured, the global proxy is used.
3. **Direct Connection**: If neither is configured, a direct connection is established.

## Global Proxy Configuration

Configure the global proxy in `browser.proxy`:

```yaml
browser:
  proxy:
    enable: true
    type: http          # http or socks5
    host: 127.0.0.1
    port: 7890
    # Optional authentication
    user: username
    passwd: password
```

## Instance-level Proxy Configuration

Configure a dedicated proxy for a specific Instance:

```yaml
backend:
  pool:
    instances:
      - name: "browser_us"
        proxy:
          enable: true
          type: socks5
          host: us-proxy.example.com
          port: 1080
          user: myuser
          passwd: mypassword
        workers:
          - name: "us_worker"
            type: lmarena
```

## Settings

| Item | Type | Required | Description |
| --- | --- | --- | --- |
| `enable` | boolean | ✅ | Whether to enable the proxy. |
| `type` | string | ✅ | Proxy type: `http` or `socks5`. |
| `host` | string | ✅ | Proxy server address. |
| `port` | number | ✅ | Proxy server port. |
| `user` | string | ❌ | Proxy authentication username. |
| `passwd` | string | ❌ | Proxy authentication password. |

## Forced Direct Connection

If you need a specific instance to force a direct connection even when a global proxy is configured:

```yaml
instances:
  - name: "browser_direct"
    proxy:
      enable: false    # Explicitly disable proxy
    workers:
      - name: "direct_worker"
        type: lmarena
```

## Proxy Selection Recommendations

::: tip Recommended Configuration
- **Type**: SOCKS5 proxies are generally more versatile than HTTP proxies.
- **Stability**: Choose stable and reliable proxy service providers.
- **IP Quality**: Use tools like [ping0.cc](https://ping0.cc) to check the quality of your IP.
:::

::: warning Notes
- Proxy quality directly affects the frequency of CAPTCHA challenges.
- Frequent IP changes may lead to account risk management.
- We recommend using residential IPs or static datacenter IPs.
:::
