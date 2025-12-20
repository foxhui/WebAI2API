# Cookies API

获取浏览器实例的 Cookie，可用于其他工具。

## 端点

```
GET /v1/cookies
```

## 查询参数

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `name` | string | ❌ | 浏览器实例名称 |
| `domain` | string | ❌ | 过滤指定域名的 Cookie |

## 请求示例

### 获取所有 Cookie

```bash
curl -X GET http://localhost:3000/v1/cookies \
  -H "Authorization: Bearer sk-your-key"
```

### 指定实例和域名

```bash
curl -X GET "http://localhost:3000/v1/cookies?name=browser_default&domain=lmarena.ai" \
  -H "Authorization: Bearer sk-your-key"
```

## 响应格式

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

## 使用场景

::: tip 应用场景
- 将 Cookie 导出给其他自动化工具使用
- 利用本项目的自动续登功能保持 Cookie 新鲜
- 调试登录状态问题
:::
