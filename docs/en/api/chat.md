::: info
This English version is translated by **Gemini 3 Flash**.
:::

# Chat Completions

The chat generation interface, compatible with the OpenAI Chat Completions API.

## Endpoint

```
POST /v1/chat/completions
```

## Request Parameters

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `model` | string | ✅ | Model name |
| `messages` | array | ✅ | List of messages |
| `stream` | boolean | ❌ | Whether to enable streaming responses (recommended) |

### messages Format

```json
{
  "messages": [
    {
      "role": "user",
      "content": "Generate a cute cat"
    }
  ]
}
```

### Multi-modal Requests (Image-to-Image / Image-to-Text)

```json
{
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "text",
          "text": "Make this image more vibrant"
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

## Image Limitations

| Item | Description |
| --- | --- |
| Supported Formats | PNG, JPEG, GIF, WebP |
| Quantity Limit | Default 5, Maximum 10 |
| Data Format | Base64 Data URL (`data:image/jpeg;base64,...`) |
| Auto-transformation | The server automatically converts images to JPG format |

## Non-streaming Response

### Request Example

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

### Response Example

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

## Streaming Response

::: tip Recommendation
Streaming mode includes a heartbeat mechanism to keep the connection alive, preventing timeouts during long generations.
:::

### Request Example

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

### Response Example

```
data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1732374740,"model":"gemini-3-pro-image-preview","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}

: keep-alive

: keep-alive

data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1732374740,"model":"gemini-3-pro-image-preview","choices":[{"index":0,"delta":{"content":"![generated](data:image/jpeg;base64,/9j/4AAQ...)"},"finish_reason":"stop"}]}

data: [DONE]
```

## Error Handling

### Queue Full (429)

```json
{
  "error": {
    "message": "Queue is full",
    "type": "rate_limit_exceeded",
    "code": "QUEUE_FULL"
  }
}
```

::: tip Solution
Enabling streaming mode (`stream: true`) allows for unlimited queuing, avoiding 429 errors.
:::

### Model Not Supported (400)

```json
{
  "error": {
    "message": "No Worker supports model: invalid-model",
    "type": "invalid_request_error",
    "code": "MODEL_NOT_FOUND"
  }
}
```
