::: info
This English version is translated by **Gemini 3 Flash**.
:::

# Models API

Retrieve the list of currently available models.

## Endpoint

```
GET /v1/models
```

## Request Example

```bash
curl -X GET http://localhost:3000/v1/models \
  -H "Authorization: Bearer sk-your-key"
```

## Response Format

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

## Model Naming Conventions

### Short Form

Use the Model ID directly:

```
gemini-3-pro-image-preview
```

The system will automatically match a Worker that supports this model.

### Explicit Backend Form

Use the `backend/model` format:

```
lmarena/gemini-3-pro-image-preview
gemini_biz/gemini-3-pro-image-preview
```

This forces the request to be handled by a specific backend.

## Model Types

| Type | Description |
| --- | --- |
| `image` | Image generation models |
| `text` | Text generation models |

::: info Note
The list of returned models depends on the currently configured Workers and their adapter types.
:::
