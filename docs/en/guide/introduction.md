# WebAI2API

::: info
This English version is translated by **Gemini 3 Flash**.
:::

## Project Introduction

**WebAI2API** is a tool that converts web-based AI services into a universal API based on **Camoufox (Playwright)**. By mimicking human operations to interact with websites like LMArena and Gemini, it provides interfaces compatible with the **OpenAI format**, while supporting **multi-window concurrency** and **multi-account management** (browser instance data isolation).

### 📋 Support List

| Website | Text Gen | Image Gen | Video Gen |
| :--- | :---: | :---: | :---: | 
| [**LMArena**](https://lmarena.ai/) | ✅ | ✅ | 🚫 |
| [**Gemini Enterprise Business**](https://business.gemini.google/) | ✅ | ✅ | ✅ |
| [**Nano Banana Free**](https://nanobananafree.ai/) | 🚫 | ✅ | 🚫 |
| [**zAI**](https://zai.is/) | ✅ | ✅ | 🚫 |
| [**Google Gemini**](https://gemini.google.com/) | ✅ | ✅ | ✅ | 
| [**ZenMux**](https://zenmux.ai/) | ✅ | ❌ | 🚫 | 
| [**ChatGPT**](https://chatgpt.com/) | ✅ | ✅ | 🚫 | 
| [**DeepSeek**](https://chat.deepseek.com/) | ✅ | 🚫 | 🚫 | 
| [**Sora**](https://sora.chatgpt.com/) | 🚫 | 🚫 | ✅ | 
| [**Google Flow**](https://labs.google/fx/zh/tools/flow) | 🚫 | ✅ | ❌ | 
| [**Doubao**](https://www.doubao.com/) | ✅ | ✅ | ❌ | 
| More coming soon... | - | - | - | 

::: tip Note
**Get Full Model List**: Use the `GET /v1/models` endpoint to view all available models and their details in your current configuration.

✅ Supported; ❌ Not currently supported, but may be in the future; 🚫 Not supported by the website.
:::

## Screenshots

![WebAI2API](/guide_introduction/1.webp)

![WebAI2API](/guide_introduction/2.webp) 

![WebAI2API](/guide_introduction/3.webp) 

![WebAI2API](/guide_introduction/4.webp) 
