::: info
This English version is translated by **Gemini 3 Flash**.
:::

# API Overview

WebAI2API provides a RESTful API compatible with the OpenAI format.

## Basic Information

- **Base URL**: `http://localhost:3000`
- **Authentication**: Bearer Token

### Request Headers

```http
Authorization: Bearer sk-your-secret-key
Content-Type: application/json
```

## API Endpoints List

### OpenAI Compatible Interfaces

| Method | Endpoint | Description |
| --- | --- | --- |
| POST | `/v1/chat/completions` | Chat Generation |
| GET | `/v1/models` | Retrieve Model List |
| GET | `/v1/cookies` | Retrieve Cookies |

## Error Responses

All API errors return a consistent format:

```json
{
  "error": {
    "message": "Error description",
    "type": "error_type",
    "code": "ERROR_CODE"
  }
}
```

### Common Error Codes

| HTTP Status | Error Type | Description |
| --- | --- | --- |
| 401 | `unauthorized` | Authentication failed |
| 400 | `invalid_request` | Invalid request parameters |
| 404 | `not_found` | Resource not found |
| 429 | `rate_limit` | Too many requests |
| 500 | `internal_error` | Internal server error |
| 503 | `service_unavailable` | Service unavailable |

## Streaming Responses

For requests with `stream: true`, the response uses the Server-Sent Events (SSE) format:

```
data: {"id":"...","object":"chat.completion.chunk",...}

: keep-alive

data: {"id":"...","object":"chat.completion.chunk",...}

data: [DONE]
```

::: tip Heartbeat/Keep-alive
Streaming requests automatically send heartbeat packets to prevent connection timeouts. The format depends on the configured `keepalive.mode`.
:::

## Related Documents

- [Chat Completions](/en/api/chat) - Detailed documentation for the chat generation interface.
- [Models](/en/api/models) - Model list interface.
- [Cookies](/en/api/cookies) - Cookie retrieval interface.
