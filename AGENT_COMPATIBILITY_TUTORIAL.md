# Universal Agent Tool Calling 兼容层教程

本文说明 WebAI2API 如何把只会输出文本的网页模型，安全地接入 Chat Completions、Responses、Codex CLI 和 OpenClaw 的工具循环。示例中的密钥均使用占位符；仓库不保存密码、Cookie、Token 或浏览器数据。

## 1. 解决的问题

普通文本适配器只需把用户消息交给网页模型，再把文本返回给 API 客户端。Agent 客户端还要求模型声明下一步工具，并在客户端执行后继续对话：

```text
客户端                  WebAI2API                     网页模型
  | tools + messages  ->  IR/校验/队列  ->  文本协议提示与网页适配
  | <- function_call  <-  解析/生成 call_id <-  工具意图文本
  | 执行本地工具
  | function_call_output -> 状态校验 -> 下一轮网页模型
```

WebAI2API 不替客户端执行工具。它只把网页模型的工具意图转换成标准 `function_call`，并把客户端返回的 `function_call_output` 作为下一轮上下文。

## 2. Universal Agent IR

所有入口先归一化为同一组结构：

- `system`、`developer`、`user`、`assistant`、`tool` 消息；
- `text`、`image`、`tool_call`、`tool_result` 内容部件；
- 带 `name`、`description` 和严格 JSON Schema 的工具定义；
- 每个调用一个唯一 `call_id`；工具结果只能引用已声明且尚未完成的调用；
- Responses 的 `response_id` 用于保存跨请求状态，并受 TTL、数量上限约束。

因此 Chat Completions 和 Responses 共用状态机、校验器、队列和编排器，而不会把某条线协议的字段泄漏到另一条协议。

## 3. 两个公开协议入口

### Chat Completions

请求 `POST /v1/chat/completions`。带 `tools` 时进入 Agent 路径；模型调用工具时返回 `choices[0].message.tool_calls[]`，参数是 JSON 字符串，`finish_reason` 为 `tool_calls`。客户端执行后，以 `role: "tool"` 和对应 `tool_call_id` 回传结果。

### Responses

请求 `POST /v1/responses`。首轮在 `output` 中返回 `function_call`；客户端用 `previous_response_id` 和 `function_call_output` 续接。`stream=true` 由缓冲层输出稳定的 `response.created`、参数增量、`response.output_item.done`、`response.completed` 等事件。

实现先收集并规范化网页 SSE，再输出 API 事件，避免把心跳、半截 XML 或未闭合 JSON 冒充真实 token/工具参数。OpenClaw 的 Responses 接口也采用“工具结果回传后继续循环”的模型，可参考 [OpenClaw OpenResponses API](https://docs.openclaw.ai/gateway/openresponses-http-api)。

## 4. 策略、解析器和状态机

请求进入队列后按“适配器 → 模型族 → 策略 → 解析器”选择：

1. 适配器负责浏览器会话和原始文本；
2. 策略生成最小工具协议提示；
3. 解析器只接受自己声明的格式，不猜工具名、不把普通文本误判为调用；
4. 编排器把解析结果交给状态机，再生成 Chat 或 Responses 响应。

当前策略/解析器覆盖 OpenAI-like、Qwen Hermes、Qwen3-Coder、Gemini-like、Anthropic-like，并保留原生 pass-through 扩展位。未知格式、未知工具、错误参数、孤儿结果、重复 `call_id` 都失败关闭。

工具结果即使是错误或非零退出码，也是真实证据：任务未完成时模型应继续选择下一个已声明工具，不能因为第一次失败就声称工具不可用。执行权始终在客户端。

## 5. Synthetic 网页模型的兼容参数

默认配置保持客户端语义，不强迫网页模型：

```yaml
agentCompatibility:
  enabled: false
  temporaryChat: true              # 只影响 Agent 网页回合；false 可退出
  forceInitialToolChoice: false    # 默认保留首轮 AUTO
  forceInitialToolName: exec       # forceInitialToolChoice=true 时可选
  forceSyntheticToolChoiceTurns: 0 # 只在已有真实 tool_result 后约束续轮
  maxSyntheticToolRetries: 0       # 0 关闭；实现最多接受 3 次
  retrySyntheticAutoFinal: false   # AUTO 首轮提前输出最终文本时可选重试
  maxSyntheticInstructionChars: 12000
```

参数含义：

- `forceInitialToolChoice=true` 时，首个 Synthetic 提供方回合可使用 `required` 或指定函数名；公共响应仍报告客户端原来的 `AUTO`。
- `forceInitialToolChoice=false` 且 `forceSyntheticToolChoiceTurns>0` 时，首轮保持自然选择；只有已有真实工具结果后，最多 N 个续轮被要求继续发出一个工具包，避免模型在中途提前结束。
- `maxSyntheticToolRetries` 只重试没有真实工具包的协议失败、过早最终文本或空网页响应；不会伪造 `tool_call`，也不会重放已经执行的工具结果。
- `maxSyntheticInstructionChars` 对系统/开发者说明做头尾截断，保留任务消息和工具结果，防止网页模型上下文被大型 skills 或 bootstrap 文件淹没。
- Agent 默认使用临时 Chat，避免根 URL 恢复上一个线程后污染多轮协议；普通聊天仍使用原有 `backend.adapter.chatgpt_text.temporaryChat` 设置。

隔离 Canary 的实测参数是 `temporaryChat=true`、`forceInitialToolChoice=false`、`forceSyntheticToolChoiceTurns=6`、`maxSyntheticToolRetries=2`、`retrySyntheticAutoFinal=true`、`maxSyntheticInstructionChars=30000`。仓库默认样例仍关闭 Agent；当前部署实例按同一兼容层配置启用，实际模型和网页账户仍需单独验证。

## 6. 浏览器适配与 OpenClaw 验收

ChatGPT 网页可能先发送 Sentinel 请求，再发送 conversation SSE；适配器会等待真实 conversation POST，读取 `final/text` 消息，并在空最终消息时快速退出，让编排器执行有界重试。对未闭合的工具 envelope 才使用较长 DOM 稳定等待。

真实 OpenClaw 验收必须看工具轨迹和磁盘状态，而不是最终自然语言：

1. 失败的测试命令真实返回非零；
2. `read` 返回原始源码；
3. `edit` 只修改指定文件；
4. 第二次测试真实返回零并有成功 stdout；
5. `exec` 生成 UUID 文件；
6. `read` 回读 UUID，并与磁盘内容交叉核对。

本分支在隔离 Canary 的第 72 次运行观察到六步全部成功，session JSONL 为 6 次工具调用、0 次失败。此前第 71 次的空最终消息被修复为快速、有限的重试路径。

## 7. 本机独立 Codex CLI 验证

官方 Codex CLI 可以在一次性 fixture 中读文件、编辑文件、执行命令，也可以用 `codex exec` 做非交互运行。验收使用隔离目录和配置，不修改用户默认 `~/.codex/config.toml`：

```toml
# <local-canary-home>/config.toml
model = "gpt-instant"
model_provider = "webai_canary"
approval_policy = "never"
sandbox_mode = "danger-full-access"

[model_providers.webai_canary]
base_url = "http://127.0.0.1:3301/v1"
env_key = "CODEX_CANARY_TOKEN"
wire_api = "responses"
requires_openai_auth = false
```

令牌只在进程环境中注入，运行后立即清除；不要写入 TOML、Shell 历史、日志或提交。真实验收应核对失败测试、指定源码修改、成功 exit code/stdout、UUID 文件和最终 Git diff。

## 8. 安全边界、隔离和回滚

- 工具名必须来自本轮声明集合；参数必须是对象并按 JSON Schema 校验；拒绝对象污染键；
- 历史只在成功 Agent 回合后写入，受 TTL 和数量上限约束；
- Canary 使用独立容器、数据目录、浏览器 profile、端口和 OpenClaw profile；生产端口 3000 使用独立的生产容器和原有数据挂载，默认 OpenClaw gateway 未被重启或改配置；
- 生产切换前保存原镜像、配置哈希、profile 备份和回滚命令；
- 日志只记录策略、计数、状态和安全诊断，不记录完整提示词、工具参数或凭据。

## 9. 本地回归与发布顺序

在仓库根目录运行：

```powershell
npm test
git diff --check
```

当前回归为 **46/46**，覆盖 IR、Schema、状态机、Chat/Responses 路由、队列、策略、解析器、选择约束、空响应重试、指令截断和网页工具参数中的非法反斜杠修复。

建议发布顺序：

1. 独立分支运行本地回归；
2. 用独立 Codex CLI 做真实工具闭环；
3. 在独立端口 Canary 上验证 Chat/Responses/OpenClaw；
4. 核对生产健康接口、镜像和配置哈希，并保留旧容器回滚入口；
5. 提交本分支并推送 GitHub，创建 Draft PR；
6. 评审和生产门禁通过后再替换生产镜像；
7. 生产切换后再次做健康检查和真实 Agent 闭环，并记录旧镜像、配置哈希和可执行回滚命令。

不要提交临时 runner、浏览器 profile、Cookie、Token、远端配置或任何凭据。
