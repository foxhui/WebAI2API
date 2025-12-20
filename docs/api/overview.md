# API 概览

WebAI2API 提供兼容 OpenAI 格式的 RESTful API。

## 基础信息

- **Base URL**: `http://localhost:3000`
- **认证方式**: Bearer Token

### 请求头

```http
Authorization: Bearer sk-your-secret-key
Content-Type: application/json
```

## API 端点列表

### OpenAI 兼容接口

| 方法 | 端点 | 说明 |
| --- | --- | --- |
| POST | `/v1/chat/completions` | 对话生成 |
| GET | `/v1/models` | 获取模型列表 |
| GET | `/v1/cookies` | 获取 Cookie |

### 管理接口

| 方法 | 端点 | 说明 |
| --- | --- | --- |
| GET | `/admin/status` | 服务状态 |
| GET | `/admin/stats` | 统计信息 |
| GET | `/admin/queue` | 队列状态 |
| POST | `/admin/restart` | 重启服务 |
| POST | `/admin/stop` | 停止服务 |
| GET | `/admin/vnc/status` | VNC 状态 |
| POST | `/admin/cache/clear` | 清理缓存 |

## 错误响应

所有 API 错误返回统一格式：

```json
{
  "error": {
    "message": "错误描述",
    "type": "error_type",
    "code": "ERROR_CODE"
  }
}
```

### 常见错误码

| HTTP 状态码 | 错误类型 | 说明 |
| --- | --- | --- |
| 401 | `unauthorized` | 认证失败 |
| 400 | `invalid_request` | 请求参数错误 |
| 404 | `not_found` | 资源不存在 |
| 429 | `rate_limit` | 请求过多 |
| 500 | `internal_error` | 服务器内部错误 |
| 503 | `service_unavailable` | 服务不可用 |

## 流式响应

对于 `stream: true` 的请求，响应使用 Server-Sent Events (SSE) 格式：

```
data: {"id":"...","object":"chat.completion.chunk",...}

: keep-alive

data: {"id":"...","object":"chat.completion.chunk",...}

data: [DONE]
```

::: tip 心跳保活
流式请求会自动发送心跳包防止连接超时，格式取决于配置的 `keepalive.mode`。
:::

## 相关文档

- [Chat Completions](/api/chat) - 对话生成接口详解
- [Models](/api/models) - 模型列表接口
- [Cookies](/api/cookies) - Cookie 获取接口
