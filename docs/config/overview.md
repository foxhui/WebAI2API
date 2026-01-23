# 配置文件概览、

WebAI2API 使用 YAML 格式的配置文件 `config.yaml` 进行配置。

::: warning 注意
项目的配置问价已可以完全使用 WebUI 进行配置，若您不了解 YAML 文件，请直接略过该板块访问 WebUI 修改配置！
:::

## 配置文件结构

```yaml
# 日志等级
logLevel: info

# 服务器配置
server:
  port: 3000
  auth: sk-your-key
  keepalive:
    mode: "comment"

# 后端配置
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

# 队列配置
queue:
  queueBuffer: 2
  imageLimit: 5

# 浏览器配置
browser:
  # 浏览器可执行文件路径 (留空则使用默认的)
  # 非必要不建议修改，否则你要处理很多额外依赖
  # Windows系统示例 "C:\\camoufox\\camoufox.exe"
  # Linux系统示例 "/opt/camoufox/camoufox"
  path: ""
  
  # 是否启用无头模式
  headless: false

  # 拟人鼠标轨迹模式
  # - false:  禁用拟人轨迹，使用 Playwright 原生点击（性能最好，但会被自动化检测）
  # - true:   使用项目优化的 ghost-cursor（更拟人化，如不会点击正中心，但性能稍差）
  # - "camou": 使用 Camoufox 内置轨迹（性能与拟人化的平衡）
  humanizeCursor: true

  # 站点隔离 (fission.autostart)
  # 开启保持 Firefox 默认开启状态
  # 关闭此项可显著降低内存占用，防止低配服务器崩溃
  # ⚠️ 风险提示: 正常 Firefox 用户默认开启 Fission，虽然关闭它不会泄露常规指纹，
  # 但极高阶的反爬系统可能会通过检测“单进程模型”或“跨进程通信延迟”来识别自动化特征！
  fission: true

  # CSS 性能优化注入
  # 通过禁用网页特效在无显卡环境下降低 CPU 压力
  cssInject:
    # 禁用网页动画
    # 作用：移除 transition 和 animation
    # 收益：显著降低 CPU 持续占用
    # 风险：低。几乎不影响浏览器指纹，但可能导致部分网页布局异常
    animation: false

    # 禁用滤镜和阴影
    # 作用：移除 blur(模糊)、box-shadow(阴影) 等复杂渲染
    # 收益：在无显卡环境下，能避免 CPU 占用 100% 导致卡顿
    # 风险：中。界面会变得难看，少数反爬可能会检测样式计算结果
    filter: false

    # 降低字体渲染质量
    # 作用：关闭字体抗锯齿，强制使用极速渲染模式
    # 收益：微量减少 CPU 绘图压力
    # ⚠️ 风险：高。会导致文字边缘有锯齿，且可能导致字体指纹与标准浏览器不符（易被高级反爬识别）
    font: false
  
  # [全局代理] 如果 Instance 没有独立配置代理，将使用此配置
  proxy:
    # 是否启用代理
    enable: false
    # 代理类型: http 或 socks5
    type: http
    # 代理主机
    host: 127.0.0.1
    # 代理端口
    port: 7890
    # 代理认证 (可选)
    # user: username
    # passwd: password
```

## 配置项说明

### 日志配置

| 配置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `logLevel` | string | `info` | 日志等级：`debug`、`info`、`warn`、`error` |

### 服务器配置 (server)

| 配置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `port` | number | `3000` | HTTP 服务监听端口 |
| `auth` | string | - | API 鉴权 Token (Bearer Token) |
| `keepalive.mode` | string | `comment` | 心跳模式：`comment` 或 `content` |

::: tip 心跳模式说明
- **comment**: 发送 `:keepalive` 注释，不污染数据（推荐）
- **content**: 发送空 delta，用于必须收到 JSON 才重置超时的客户端
:::

### 队列配置 (queue)

| 配置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `queueBuffer` | number | `2` | 非流式请求的额外排队数，0 表示不限制 |
| `imageLimit` | number | `5` | 单次请求最大图片数量 (最大 10) |

### 浏览器配置 (browser)

| 配置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `path` | string | `""` | Camoufox 可执行文件路径，留空使用默认 |
| `headless` | boolean | `false` | 是否启用无头模式 |
| `fission` | boolean | `true` | 是否启用站点隔离 (fission.autostart) |
| `humanizeCursor` | boolean/string | `true` | 鼠标轨迹模式：`true`, `false`, `"camou"` |
| `proxy` | object | - | 全局代理配置 |
| `cssInject` | object | - | CSS 性能优化注入配置 |

#### CSS 优化注入 (cssInject)

针对无显卡 (CPU-Only) 环境的性能优化选项。通过注入 CSS 禁用部分网页特效来降低 CPU 负载。

| 配置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `animation` | boolean | `false` | **禁用动画** (推荐)<br>作用：移除 transition 和 animation<br>收益：显著降低 CPU 持续占用<br>风险：极低 (几乎不影响指纹) |
| `filter` | boolean | `false` | **禁用特效**<br>作用：移除 blur、box-shadow 等<br>收益：避免复杂渲染导致的卡顿<br>风险：中 (界面美观度下降，极少反爬检测) |
| `font` | boolean | `false` | **极速字体**<br>作用：关闭字体抗锯齿<br>收益：微量减少绘图压力<br>风险：**高** (字体指纹异常，易被高级反爬识别) |

### 后端资源池 (backend.pool)

| 配置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `strategy` | string | `least_busy` | 负载均衡策略，可选：`least_busy` |
| `failover.enabled` | boolean | `true` | 是否启用故障自动转移 |
| `failover.maxRetries` | number | `2` | 故障转移最大重试次数 |
| `instances` | array | - | 浏览器实例列表，详见 [实例配置](/config/instances) |

### 适配器配置 (backend.adapter)

每个适配器都可以配置专属的模型黑白名单，用于控制该适配器可以使用的模型列表。

| 配置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `modelFilter.mode` | string | - | 过滤模式：`whitelist` (白名单) 或 `blacklist` (黑名单) |
| `modelFilter.list` | array | - | 模型列表（根据 mode 决定是启用列表还是禁用列表） |

::: tip 模型过滤说明
- **whitelist (白名单模式)**：仅允许列表中的模型
- **blacklist (黑名单模式)**：禁用列表中的模型，其他模型可用
- 推荐使用 WebUI 进行配置
:::

配置示例：

```yaml
backend:
  adapter:
    lmarena:
      returnUrl: false
      modelFilter:
        mode: whitelist                        # 白名单模式
        list:                                  # 仅启用以下模型
          - gemini-3-pro-image-preview
          - gemini-3-pro-image-preview-2k
          - gemini-2.5-flash-image-preview
```

## 相关文档

- [实例配置](/config/instances) - 浏览器实例和 Worker 详细配置
- [代理设置](/config/proxy) - 代理配置详解
