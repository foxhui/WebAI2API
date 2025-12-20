# 实例配置

实例 (Instance) 和工作者 (Worker) 是 WebAI2API 的核心配置概念。

## 概念说明

### Instance (浏览器实例)

一个 Instance 代表一个独立的浏览器进程，具有：
- 独立的用户数据目录
- 独立的 Cookie 和登录状态
- 可选的专属代理配置

### Worker (工作者)

Worker 是 Instance 内的一个标签页，负责与特定平台交互。同一 Instance 下的多个 Worker：
- 共享浏览器数据和登录状态
- 共享代理配置
- 可以是不同的适配器类型

## 配置结构

```yaml
backend:
  pool:
    instances:
      - name: "browser_default"    # 实例 ID
        userDataMark: "01"         # 数据目录标识 (可选)
        proxy:                      # 实例级代理 (可选)
          enable: true
          type: socks5
          host: 127.0.0.1
          port: 1080
        workers:                    # Worker 列表
          - name: "worker1"
            type: lmarena
          - name: "worker2"
            type: zai_is
```

## Instance 配置项

| 配置项 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `name` | string | ✅ | 实例唯一标识，用于日志和 Cookie 获取 |
| `userDataMark` | string | ❌ | 数据目录标识，留空使用默认目录 |
| `proxy` | object | ❌ | 实例级代理配置，参见[代理设置](/config/proxy) |
| `workers` | array | ✅ | Worker 配置列表 |

### 数据目录

- 默认位置: `data/camoufoxUserData`
- 设置 `userDataMark` 后: `data/camoufoxUserData_{mark}`

## Worker 配置项

| 配置项 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `name` | string | ✅ | Worker 唯一标识（全局唯一） |
| `type` | string | ✅ | 适配器类型 |
| `mergeTypes` | array | ❌ | 聚合模式的适配器列表 (type=merge 时必填) |
| `mergeMonitor` | string | ❌ | 空闲时监控的后端 (可选) |

### 适配器类型

| 类型 | 说明 |
| --- | --- |
| `lmarena` | LMArena 图片生成 |
| `lmarena_text` | LMArena 文本生成 |
| `gemini_biz` | Gemini Business 图片生成 |
| `gemini_biz_text` | Gemini Business 文本生成 |
| `gemini` | Google Gemini |
| `zai_is` | zAI 图片生成 |
| `nanobananafree_ai` | Nano Banana Free |
| `merge` | 聚合模式（单标签多后端） |

## 聚合模式 (Merge)

聚合模式允许在单个标签页中支持多个后端，实现故障转移：

```yaml
workers:
  - name: "merged_worker"
    type: merge
    mergeTypes: [gemini_biz, lmarena, zai_is]
    mergeMonitor: gemini_biz  # 空闲时挂机监控的后端
```

::: tip 聚合模式优势
- 节省浏览器资源
- 自动故障转移
- 统一登录状态
:::

## 配置示例

### 单实例单 Worker

```yaml
instances:
  - name: "default"
    workers:
      - name: "worker1"
        type: lmarena
```

### 多实例隔离

```yaml
instances:
  # 实例 1: 美国代理
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

  # 实例 2: 日本代理
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

### 聚合模式

```yaml
instances:
  - name: "browser_merged"
    workers:
      - name: "all_in_one"
        type: merge
        mergeTypes: [gemini_biz, lmarena, zai_is]
        mergeMonitor: gemini_biz
```
