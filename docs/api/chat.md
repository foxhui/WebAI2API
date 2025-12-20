# Chat Completions

对话生成接口，兼容 OpenAI Chat Completions API。

## 端点

```
POST /v1/chat/completions
```

## 请求参数

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `model` | string | ✅ | 模型名称 |
| `messages` | array | ✅ | 消息列表 |
| `stream` | boolean | ❌ | 是否启用流式响应（推荐开启） |

### messages 格式

```json
{
  "messages": [
    {
      "role": "user",
      "content": "生成一只可爱的猫"
    }
  ]
}
```

### 多模态请求（图生图）

```json
{
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "text",
          "text": "让这张图片更加鲜艳"
        },
        {
          "type": "image_url",
          "image_url": {
            "url": "data:image/jpeg;base64,/9j/4AAQ..."
          }
        }
      ]
    }
  ]
}
```

## 图片限制

| 限制项 | 说明 |
| --- | --- |
| 支持格式 | PNG, JPEG, GIF, WebP |
| 数量限制 | 默认 5 张，最大 10 张 |
| 数据格式 | Base64 Data URL (`data:image/jpeg;base64,...`) |
| 自动转换 | 服务器会自动转换为 JPG 格式 |

## 非流式响应

### 请求示例

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-your-key" \
  -d '{
    "model": "gemini-3-pro-image-preview",
    "messages": [
      {
        "role": "user",
        "content": "generate a cat"
      }
    ]
  }'
```

### 响应示例

```json
{
  "id": "chatcmpl-1732374740123",
  "object": "chat.completion",
  "created": 1732374740,
  "model": "gemini-3-pro-image-preview",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "![generated](data:image/jpeg;base64,/9j/4AAQ...)"
      },
      "finish_reason": "stop"
    }
  ]
}
```

## 流式响应

::: tip 推荐使用
流式模式包含心跳保活机制，可以避免长时间生成导致的连接超时。
:::

### 请求示例

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-your-key" \
  -d '{
    "model": "gemini-3-pro-image-preview",
    "stream": true,
    "messages": [
      {
        "role": "user",
        "content": "generate a cat"
      }
    ]
  }'
```

### 响应示例

```
data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1732374740,"model":"gemini-3-pro-image-preview","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}

: keep-alive

: keep-alive

data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1732374740,"model":"gemini-3-pro-image-preview","choices":[{"index":0,"delta":{"content":"![generated](data:image/jpeg;base64,/9j/4AAQ...)"},"finish_reason":"stop"}]}

data: [DONE]
```

## 错误处理

### 队列已满 (429)

```json
{
  "error": {
    "message": "队列已满",
    "type": "rate_limit_exceeded",
    "code": "QUEUE_FULL"
  }
}
```

::: tip 解决方案
启用流式模式 (`stream: true`) 可以无限排队，避免 429 错误。
:::

### 模型不支持 (400)

```json
{
  "error": {
    "message": "没有 Worker 支持模型: invalid-model",
    "type": "invalid_request_error",
    "code": "MODEL_NOT_FOUND"
  }
}
```
