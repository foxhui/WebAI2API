::: info
This English version is translated by **Gemini 3 Flash**.
:::

# Cookies API

Retrieve cookies from browser instances, which can be used by other tools.

## Endpoint

```
GET /v1/cookies
```

## Query Parameters

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | string | ❌ | Browser instance name |
| `domain` | string | ❌ | Filter cookies by a specific domain |

## Request Example

### Get All Cookies

```bash
curl -X GET http://localhost:3000/v1/cookies \
  -H "Authorization: Bearer sk-your-key"
```

### Specify Instance and Domain

```bash
curl -X GET "http://localhost:3000/v1/cookies?name=browser_default&domain=lmarena.ai" \
  -H "Authorization: Bearer sk-your-key"
```

## Response Format

```json
{
  "instance": "browser_default",
  "cookies": [
    {
      "name": "_GRECAPTCHA",
      "value": "09ADxxxxxx",
      "domain": "www.google.com",
      "path": "/recaptcha",
      "expires": 1780000000,
      "httpOnly": true,
      "secure": true,
      "sameSite": "None"
    },
    {
      "name": "OTZ",
      "value": "8888888_24_24__24_",
      "domain": "accounts.google.com",
      "path": "/",
      "expires": 1760000000,
      "httpOnly": false,
      "secure": true,
      "sameSite": "None"
    }
  ]
}
```

## Usage Scenarios

::: tip Application Scenarios
- Export cookies for use in other automation tools.
- Leverage this project's automatic session renewal to keep cookies fresh.
- Debug login state issues.
:::
