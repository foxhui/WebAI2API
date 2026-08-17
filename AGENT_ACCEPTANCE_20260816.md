# Agent 兼容层验收记录（2026-08-16 最终复核）

本记录只写入已观察到的证据；密码、Cookie、Token 和完整敏感配置值均不写入。

## 实现与静态验证

- 分支：`feat/agent-compatibility-layer`
- `npm test`：**43 tests passed，0 failed**。
- `git diff --check`：通过。
- 已实现 Universal Agent IR、Chat Completions、Responses、状态/Schema/ID 校验、缓冲流、GPT/Qwen/Gemini/Anthropic 风格策略与解析器，以及能力注册；WebAI2API 不执行客户端工具。
- Synthetic 兼容层保留客户端的 `tool_choice=auto`：可选的首轮约束只作用于提供方提示；有界续轮约束只在已有真实 `tool_result` 后生效；超过上限自动回到 AUTO。
- 对网页 SSE 的空最终消息增加了有界重试；没有解析出真实工具包时不会生成或伪造工具调用。

## Codex 真实验收

使用隔离 Codex 配置、独立 fixture 和 Canary Responses 地址；原用户 Codex 配置未修改。

- Codex 进程退出码：0。
- 初次 `npm test` 真实退出码 1；随后读取 `src/value.js`，只修改该文件为 `module.exports = 2`，再次测试退出码 0，stdout 含 `CODEX_CANARY_TEST_OK`。
- 真实创建并回读 UUID 文件；Git 状态只包含预期源码修改和新文件。

这部分证明的是独立 Codex CLI 的真实工具闭环，不把静态测试或模拟响应冒充为浏览器验收。

## Responses 真实验收

隔离 Canary 上已观察到：

- 首次 `/v1/responses` 返回 200 和真实 `function_call`；客户端执行后用 `previous_response_id`/`function_call_output` 续接。
- 续接请求返回 200；完成时没有工具调用，最终文本包含实际工具结果。
- `stream=true` 返回 `text/event-stream`，包含 `response.created`、参数增量、`response.output_item.done` 和 `response.completed` 等规范事件。
- `tool_choice=auto` 仍可返回普通文本；`required` 可要求提供方生成工具包；公共 IR 不被兼容层改写。

## OpenClaw 真实验收（已通过）

测试使用独立 OpenClaw profile、独立 workspace、Canary `3301` 端口和临时 Chat 会话；默认 `openclaw-gateway`、默认配置、默认 workspace、登录状态以及生产 `webai2api:3000` 均未修改。测试 profile 只允许 `read`、`edit`、`exec`，并关闭无关 skills，以保持六步验收边界。

第 71 次复跑已经真实完成前两步，但第三回合收到空的最终消息并等待超时。修复后新增“空响应有界重试”与较短的空 DOM 等待，第 72 次复跑完整通过：

1. `exec` 在隔离的 `<canary-fixture>` 目录运行 `npm test`，真实退出码 1；
2. `read` 回读 `src/value.js`，内容为 `module.exports = 1;`；
3. `edit` 只把该文件改成 `module.exports = 2;`；
4. 再次 `exec npm test`，真实退出码 0，输出 `OPENCLAW_CANARY_TEST_OK`；
5. `exec uuidgen > openclaw-created.txt`，真实退出码 0；
6. `read` 回读 UUID 文件，内容与磁盘文件一致。

交叉证据：OpenClaw session JSONL 记录 `calls=6`、工具集合 `exec/read/edit`、`failures=0`；远端 fixture 最终为 `module.exports = 2`，UUID 文件确实存在。最终文本中的格式化小缺口没有被用作证据，验收只采信工具结果、退出码和磁盘状态。

## 部署与回滚边界

- Canary：`webai2api-agent-canary`，端口 `3301`，独立数据目录和 profile；当前兼容参数为 `temporaryChat=true`、`forceInitialToolChoice=false`、`forceSyntheticToolChoiceTurns=6`、`maxSyntheticToolRetries=2`、`retrySyntheticAutoFinal=true`、`maxSyntheticInstructionChars=30000`。
- 生产：`webai2api` 仍使用原镜像和正式端口 `3000`；未切换生产配置或浏览器 profile。
- 默认 OpenClaw gateway 未重启、未改配置；Canary 的 workspace 原文件保存在隔离备份目录，可回滚。
- 远端源码覆盖只发生在 Canary 容器，保留了原始文件和配置备份；生产升级仍需单独审批与回滚演练。

## 发布门禁

1. 静态回归：43/43 通过；
2. 独立 Codex CLI：真实六步闭环通过；
3. Responses：状态续接和流式事件通过；
4. OpenClaw：真实失败测试→读→改→复测→生成 UUID→读回六步通过；
5. 生产端口 3000 未切换。

以上证据构成本分支发布前的验收记录。公开发布时只推送源码、测试和已脱敏文档，不包含 profile、Cookie、Token、临时 runner、远端路径或任何密钥。生产端口和默认 OpenClaw 配置不在本次发布范围内。

## 2026-08-18 生产迁移复核

上一节保留 2026-08-16 Canary 验收的历史边界；本节记录后续生产迁移和解析修复，不覆盖或改写 Canary 证据。

- 本地回归更新为 **46/46**；新增覆盖网页模型在工具参数字符串中输出未转义 Windows 反斜杠时的窄范围 JSON 修复。
- 生产 `webai2api` 已切换到包含该修复的提交镜像，端口仍为 `3000`，原数据挂载和三个 Worker 保留。
- 独立 Codex CLI 通过生产 Responses 地址完成真实闭环：读取 `src/value.js`、执行失败测试、修改文件、再次执行测试；两次成功测试均输出 `CODEX_PRODUCTION_3000_OK`，最终 SSE 含 `response.completed`，进程正常退出。
- 本次没有把生产 OpenClaw gateway 当作新的验收证据；OpenClaw 结论仍只引用上面的隔离 Canary 六步记录。
- 回滚容器、浏览器数据归档和配置备份均保留在部署主机；公开仓库不包含这些运行时数据。
