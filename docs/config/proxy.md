# 代理设置

WebAI2API 支持全局代理和实例级代理配置。

## 代理优先级

1. **实例级代理** - 如果 Instance 配置了代理，使用该代理
2. **全局代理** - 如果实例未配置，使用全局代理
3. **直连** - 如果都未配置，直接连接

## 全局代理配置

在 `browser.proxy` 中配置全局代理：

```yaml
browser:
  proxy:
    enable: true
    type: http          # http 或 socks5
    host: 127.0.0.1
    port: 7890
    # 可选认证
    user: username
    passwd: password
```

## 实例级代理配置

在 Instance 中配置专属代理：

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

## 配置项说明

| 配置项 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `enable` | boolean | ✅ | 是否启用代理 |
| `type` | string | ✅ | 代理类型：`http` 或 `socks5` |
| `host` | string | ✅ | 代理服务器地址 |
| `port` | number | ✅ | 代理服务器端口 |
| `user` | string | ❌ | 代理认证用户名 |
| `passwd` | string | ❌ | 代理认证密码 |

## 强制直连

如果需要某个实例强制直连，即使配置了全局代理：

```yaml
instances:
  - name: "browser_direct"
    proxy:
      enable: false    # 显式禁用代理
    workers:
      - name: "direct_worker"
        type: lmarena
```

## 代理选型建议

::: tip 推荐配置
- **类型**: SOCKS5 代理通常比 HTTP 代理更通用
- **稳定性**: 选择稳定可靠的代理服务商
- **IP 纯净度**: 使用 [ping0.cc](https://ping0.cc) 等工具检查 IP 纯净度
:::

::: warning 注意事项
- 代理质量会影响验证码触发频率
- 频繁更换 IP 可能导致账号风控
- 建议使用住宅 IP 或数据中心静态 IP
:::
