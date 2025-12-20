# Models API

获取当前可用的模型列表。

## 端点

```
GET /v1/models
```

## 请求示例

```bash
curl -X GET http://localhost:3000/v1/models \
  -H "Authorization: Bearer sk-your-key"
```

## 响应格式

```json
{
  "object": "list",
  "data": [
    {
      "id": "gemini-3-pro-image-preview",
      "object": "model",
      "created": 1732456789,
      "owned_by": "internal_server"
    },
    {
      "id": "lmarena/gemini-3-pro-image-preview",
      "object": "model",
      "created": 1732456789,
      "owned_by": "lmarena"
    },
    {
      "id": "seedream-4-high-res-fal",
      "object": "model",
      "created": 1732456789,
      "owned_by": "internal_server"
    }
  ]
}
```

## 模型命名规则

### 简写形式

直接使用模型 ID：

```
gemini-3-pro-image-preview
```

系统会自动匹配到支持该模型的 Worker。

### 指定后端形式

使用 `backend/model` 格式：

```
lmarena/gemini-3-pro-image-preview
gemini_biz/gemini-3-pro-image-preview
```

强制使用指定后端处理请求。

## 模型类型

| 类型 | 说明 |
| --- | --- |
| `image` | 图片生成模型 |
| `text` | 文本生成模型 |

::: info 说明
返回的模型列表取决于当前配置的 Worker 和适配器类型。
:::
