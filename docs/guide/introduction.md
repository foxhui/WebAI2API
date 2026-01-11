# WebAI2API

## 项目简介

**WebAI2API** 是一个基于 **Camoufox (Playwright)** 的网页版 AI 服务转通用 API 的工具。通过模拟人类操作与 LMArena、Gemini 等网站交互，提供兼容 **OpenAI 格式** 的接口服务，同时支持 **多窗口并发** 与 **多账号管理**（浏览器实例数据隔离）。

### 📋 当前支持列表

| 网站名称 | 文本生成 | 图片生成 | 视频生成 |
| :--- | :---: | :---: | :---: | 
| [**LMArena**](https://lmarena.ai/) | ✅ | ✅ | 🚫 |
| [**Gemini Enterprise Business**](https://business.gemini.google/) | ✅ | ✅ | ✅ |
| [**Nano Banana Free**](https://nanobananafree.ai/) | 🚫 | ✅ | 🚫 |
| [**zAI**](https://zai.is/) | ✅ | ✅ | 🚫 |
| [**Google Gemini**](https://gemini.google.com/) | ✅ | ✅💧 | ✅💧 | 
| [**ZenMux**](https://zenmux.ai/) | ✅ | ❌ | 🚫 | 
| [**ChatGPT**](https://chatgpt.com/) | ✅ | ✅ | 🚫 | 
| [**DeepSeek**](https://chat.deepseek.com/) | ✅ | 🚫 | 🚫 | 
| [**Sora**](https://sora.chatgpt.com/) | 🚫 | 🚫 | ✅💧 | 
| [**Google Flow**](https://labs.google/fx/zh/tools/flow) | 🚫 | ✅ | ❌ | 
| [**豆包**](https://www.doubao.com/) | ✅ | ✅ | ❌ | 
| 待续... | - | - | - | 

::: tip 实测环境表现
**获取完整模型列表**: 通过 `GET /v1/models` 接口查看当前配置下所有可用模型及其详细信息。

✅目前支持；❌目前不支持，但未来可能会支持；🚫网站不支持, 未来是否在支持看网站具体情况；💧结果带水印且无法去除；
:::

## 项目截图

![Image](/guide_introduction/1.webp)

![Image](/guide_introduction/2.webp) 

![Image](/guide_introduction/3.webp) 

![Image](/guide_introduction/4.webp) 
