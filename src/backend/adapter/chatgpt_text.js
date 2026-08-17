/**
 * @fileoverview ChatGPT 文本生成适配器
 */

import {
    sleep,
    humanType,
    safeClick,
    uploadFilesViaChooser
} from '../engine/utils.js';
import {
    normalizePageError,
    waitForInput,
    gotoWithCheck
} from '../utils/index.js';
import { logger } from '../../utils/logger.js';

// --- 配置常量 ---
const TARGET_URL = 'https://chatgpt.com/'; // 基础URL
const INPUT_SELECTOR = '.ProseMirror';

async function dismissHistoryRateLimitModal(page, meta = {}) {
    try {
        const modal = page.locator('#modal-conversation-history-rate-limit');
        if (!(await modal.isVisible().catch(() => false))) return true;

        logger.warn('适配器', '检测到 ChatGPT 历史限额模态框，尝试关闭后继续 Agent 回合', meta);
        const closeCandidates = [
            modal.getByRole('button', { name: /close|dismiss|关闭|取消/i }),
            modal.locator('button')
        ];
        let closed = false;
        for (const candidate of closeCandidates) {
            const count = Math.min(await candidate.count().catch(() => 0), 6);
            for (let index = 0; index < count; index++) {
                const button = candidate.nth(index);
                if (await button.isVisible().catch(() => false)) {
                    await button.click({ force: true, timeout: 2000 }).catch(() => { });
                    closed = true;
                    break;
                }
            }
            if (closed) break;
        }
        await page.keyboard.press('Escape').catch(() => { });
        await modal.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => { });
        return !(await modal.isVisible().catch(() => false));
    } catch (error) {
        logger.warn('适配器', `关闭 ChatGPT 历史限额模态框失败: ${error.message}`, meta);
        return false;
    }
}

/**
 * 通过 UI 选择模型
 * @param {import('playwright-core').Page} page - 页面对象
 * @param {string} codeName - 模型 codeName
 * @param {object} meta - 日志元数据
 * @returns {Promise<boolean>} 是否成功选择了模型
 */
async function selectModel(page, codeName, meta = {}) {
    try {
        const firstVisible = async (locator) => {
            const count = Math.min(await locator.count().catch(() => 0), 8);
            for (let index = 0; index < count; index++) {
                const item = locator.nth(index);
                if (await item.isVisible().catch(() => false)) return item;
            }
            return null;
        };

        // 1. 点击模型选择按钮。ChatGPT 网页经常改 aria-label，优先用 data-testid，再回退到可见文本。
        const candidates = [
            page.locator('[data-testid="model-switcher-dropdown-button"]'),
            page.getByRole('button', { name: /Model selector|models?|ChatGPT|GPT|Instant|Thinking|Pro/i }),
            page.locator('button').filter({ hasText: /ChatGPT|GPT|Instant|Thinking|Pro/i })
        ];
        let modelSelectorBtn = null;
        for (const candidate of candidates) {
            modelSelectorBtn = await firstVisible(candidate);
            if (modelSelectorBtn) break;
        }
        if (!modelSelectorBtn) {
            logger.warn('适配器', '未找到模型选择器按钮，跳过选择模型', meta);
            return false;
        }

        // 当前按钮已明确显示目标模型时不要再次打开菜单，避免网页动画或隐藏副本造成点击超时。
        const currentModelLabel = `${await modelSelectorBtn.getAttribute('aria-label').catch(() => '') || ''} ${await modelSelectorBtn.innerText().catch(() => '') || ''}`;
        if (new RegExp(`\\b${codeName}\\b`, 'i').test(currentModelLabel)) {
            logger.debug('适配器', `当前已选择模型: ${codeName}`, meta);
            return true;
        }

        await modelSelectorBtn.waitFor({ timeout: 5000 });
        await safeClick(page, modelSelectorBtn, { bias: 'button', timeout: 5000 });
        await sleep(500, 800);

        // 2. 检查是否有 Legacy models 选项
        const legacyMenuItem = page.getByRole('menuitem', { name: /^Legacy models/ });
        const legacyExists = await legacyMenuItem.count();
        if (legacyExists > 0) {
            logger.debug('适配器', '发现 Legacy models 选项，正在点击...', meta);
            await safeClick(page, legacyMenuItem, { bias: 'button' });
            await sleep(300, 500);
        }

        // 3. 查找匹配 codeName 开头的 menuitem 或 menuitemradio
        let targetMenuItem = await firstVisible(page.getByRole('menuitemradio', { name: new RegExp(`^${codeName}`, 'i') }));
        if (!targetMenuItem) {
            targetMenuItem = await firstVisible(page.getByRole('menuitem', { name: new RegExp(`^${codeName}`, 'i') }));
        }

        if (targetMenuItem) {
            logger.info('适配器', `正在选择模型: ${codeName}`, meta);
            await safeClick(page, targetMenuItem, { bias: 'button', timeout: 5000 });
            return true;
        } else {
            logger.debug('适配器', `未找到模型 ${codeName}，使用默认模型`, meta);
            // 点击空白区域关闭菜单
            await page.keyboard.press('Escape');
            return false;
        }
    } catch (e) {
        logger.warn('适配器', `选择模型失败: ${e.message}`, meta);
        // 尝试关闭菜单
        await page.keyboard.press('Escape').catch(() => { });
        return false;
    }
}

/**
 * 执行文本生成任务
 * @param {object} context - 浏览器上下文 { page, config }
 * @param {string} prompt - 提示词
 * @param {string[]} imgPaths - 图片路径数组
 * @param {string} [modelId] - 模型 ID
 * @param {object} [meta={}] - 日志元数据
 * @returns {Promise<{text?: string, error?: string}>}
 */
async function generate(context, prompt, imgPaths, modelId, meta = {}) {
    const { page, config } = context;
    const waitTimeout = config?.backend?.pool?.waitTimeout ?? 120000;
    const sendBtnLocator = page.getByRole('button', { name: 'Send prompt' });

    try {
        // Agent 请求每次都会重放完整协议上下文，不依赖网页会话历史。
        // 使用临时会话可避免高频工具轮次污染历史并触发 conversation-history-rate-limit；
        // 普通聊天仍严格保留用户的 temporaryChat 配置。
        // Agent turns are replayed from a clean composer. Temporary Chat avoids
        // accidentally reusing a stale visible conversation when the web UI
        // redirects the root URL to the last thread. Deployments can still opt
        // out explicitly if their account triggers a Sentinel challenge.
        const useTemp = meta.agentMode === true
            ? config?.agentCompatibility?.temporaryChat !== false
            : config?.backend?.adapter?.chatgpt_text?.temporaryChat || false;
        const targetUrl = useTemp ? 'https://chatgpt.com/?temporary-chat=true' : 'https://chatgpt.com/'; // 感谢 @zhongjianhua163 提供临时对话方案
        logger.info('适配器', '开启新会话...', meta);
        await gotoWithCheck(page, targetUrl);

        // 1. 等待输入框加载
        await waitForInput(page, INPUT_SELECTOR, { click: false });
        if (meta.agentMode === true) await dismissHistoryRateLimitModal(page, meta);

        // 2. 选择模型
        if (modelId) {
            const modelConfig = manifest.models.find(m => m.id === modelId);
            if (modelConfig && modelConfig.codeName) {
                await selectModel(page, modelConfig.codeName, meta);
            } else {
                logger.info('适配器', `未指定模型或未知模型 (${modelId})，跳过模型选择`, meta);
            }
        }

        // 3. 上传图片 (双击 Add files and more 按钮)
        if (imgPaths && imgPaths.length > 0) {
            logger.info('适配器', `开始上传 ${imgPaths.length} 张图片...`, meta);
            const expectedUploads = imgPaths.length;
            let uploadedCount = 0;
            let processedCount = 0;

            logger.debug('适配器', '双击添加文件按钮...', meta);
            const addFilesBtn = page.getByRole('button', { name: 'Add files and more' });

            await uploadFilesViaChooser(page, addFilesBtn, imgPaths, {
                clickAction: 'dblclick',  // 使用双击
                uploadValidator: (response) => {
                    const url = response.url();
                    if (response.status() === 200) {
                        // 上传请求
                        if (url.includes('backend-api/files') && !url.includes('process_upload_stream')) {
                            uploadedCount++;
                            logger.debug('适配器', `图片上传进度: ${uploadedCount}/${expectedUploads}`, meta);
                            return false;
                        }
                        // 处理完成请求
                        if (url.includes('backend-api/files/process_upload_stream')) {
                            processedCount++;
                            logger.info('适配器', `图片处理进度: ${processedCount}/${expectedUploads}`, meta);

                            if (processedCount >= expectedUploads) {
                                return true;
                            }
                        }
                    }
                    return false;
                }
            }, meta);
        }

        // 3. 输入提示词
        if (meta.agentMode === true) await dismissHistoryRateLimitModal(page, meta);
        logger.info('适配器', '输入提示词...', meta);
        if (meta.agentMode === true) {
            // Agent prompts are protocol payloads, not user prose. Locator.fill
            // updates contenteditable state through the browser input pipeline;
            // the old execCommand-only path can leave the Send button disabled on
            // a second temporary-chat turn even though text is visible.
            const agentInput = page.locator(INPUT_SELECTOR).first();
            await agentInput.waitFor({ state: 'visible', timeout: 15000 });
            await agentInput.scrollIntoViewIfNeeded().catch(() => { });
            // Avoid the long humanized safeClick path for the protocol textarea:
            // ChatGPT can keep a transparent composer overlay during navigation,
            // which makes a coordinate click time out even though the editor is
            // already visible and focusable.
            await agentInput.click({ force: true, timeout: 5000 }).catch(() => agentInput.focus());
            await humanType(page, INPUT_SELECTOR, prompt);
        } else {
            await safeClick(page, INPUT_SELECTOR, { bias: 'input' });
            await humanType(page, INPUT_SELECTOR, prompt);
        }
        const inputState = await page.locator(INPUT_SELECTOR).evaluate((node) => ({
            textLength: (node.innerText || node.textContent || '').length,
            contentEditable: node.getAttribute('contenteditable'),
            ariaDisabled: node.getAttribute('aria-disabled'),
            active: document.activeElement === node,
            role: node.getAttribute('role'),
            testId: node.getAttribute('data-testid'),
            placeholder: node.getAttribute('data-placeholder') || node.getAttribute('aria-label')
        })).catch(() => ({ textLength: -1, contentEditable: null, ariaDisabled: null, active: false }));
        const sendState = await page.locator('[data-testid="send-button"], button[type="submit"], button[aria-label*="Send" i], button[aria-label*="发送"]')
            .evaluateAll((buttons) => buttons.slice(0, 8).map((button) => ({
                testId: button.getAttribute('data-testid'),
                ariaLabel: button.getAttribute('aria-label'),
                type: button.getAttribute('type'),
                disabled: Boolean(button.disabled),
                ariaDisabled: button.getAttribute('aria-disabled'),
                visible: Boolean(button.offsetWidth || button.offsetHeight || button.getClientRects().length)
            })))
            .catch(() => []);
        logger.debug('适配器', 'Agent 输入状态已确认', { ...meta, inputState, sendState });

        // 4. 先启动 SSE 监听，再发送提示词（避免竞态）
        logger.info('适配器', '监听 SSE 流获取文本...', meta);

        let textContent = '';
        let isComplete = false;
        let targetMessageId = null;  // 只追踪 channel: "final" 的消息
        // Agent 请求可能让网页返回非 text content；只记录类型/数量，绝不记录提示词或工具参数。
        const agentSseDiagnostics = meta.agentMode ? {
            finalMessages: 0,
            contentTypes: new Set(),
            partKinds: new Set(),
            partCount: 0
        } : null;

        const summarizeAgentSse = () => agentSseDiagnostics ? {
            finalMessages: agentSseDiagnostics.finalMessages,
            contentTypes: [...agentSseDiagnostics.contentTypes].sort(),
            partKinds: [...agentSseDiagnostics.partKinds].sort(),
            partCount: agentSseDiagnostics.partCount
        } : undefined;

        const responsePromise = page.waitForResponse(async (response) => {
            const url = response.url();
            if (!/\/backend-api\/(?:f\/)?conversation(?:[/?#]|$)/i.test(url)) return false;
            if (response.request().method() !== 'POST') return false;
            if (response.status() !== 200) return false;

            try {
                const body = await response.text();
                const lines = body.split('\n');

                for (const line of lines) {
                    // 跳过空行和事件行
                    if (!line.startsWith('data: ')) continue;

                    const dataStr = line.slice(6).trim();
                    if (dataStr === '[DONE]') {
                        isComplete = true;
                        continue;
                    }

                    try {
                        const data = JSON.parse(dataStr);

                        const message = data.v?.message;
                        const content = message?.content;
                        if (message?.author?.role === 'assistant' && message?.channel === 'final') {
                            if (agentSseDiagnostics) {
                                agentSseDiagnostics.finalMessages++;
                                agentSseDiagnostics.contentTypes.add(String(content?.content_type || 'missing'));
                                const parts = Array.isArray(content?.parts) ? content.parts : [];
                                agentSseDiagnostics.partCount += parts.length;
                                for (const part of parts) {
                                    agentSseDiagnostics.partKinds.add(Array.isArray(part) ? 'array' : typeof part);
                                }
                            }
                        }

                        // 普通文本只追踪 final/text，避免把 commentary/thinking 混入旧路径。
                        if (message?.author?.role === 'assistant' &&
                            message?.channel === 'final' &&
                            content?.content_type === 'text') {
                            targetMessageId = data.v.message.id;
                            // 重置内容（即使 parts[0] 为空也要重置，清除之前 commentary 的文本）
                            const parts = content.parts;
                            textContent = (parts && parts[0]) || '';
                        }

                        // 以下所有内容累积都必须在 targetMessageId 设置之后才执行
                        // 避免误收 commentary / thinking 频道的内容
                        if (!targetMessageId) continue;

                        // 累积 delta 内容 (append 操作，顶层 path)
                        if (data.o === 'append' && data.p === '/message/content/parts/0' && data.v) {
                            textContent += data.v;
                        }

                        // patch 操作中的 append (数组格式)
                        if (Array.isArray(data.v)) {
                            for (const patch of data.v) {
                                if (patch.o === 'append' && patch.p === '/message/content/parts/0' && patch.v) {
                                    textContent += patch.v;
                                }
                                // 仅在 targetMessageId 存在时检查完成
                                if (patch.p === '/message/status' && patch.v === 'finished_successfully') {
                                    isComplete = true;
                                }
                            }
                        }

                        // message_stream_complete 表示完成
                        if (data.type === 'message_stream_complete') {
                            isComplete = true;
                        }
                    } catch {
                        // 忽略解析错误
                    }
                }

                return isComplete;
            } catch {
                return false;
            }
        }, { timeout: waitTimeout });
        // 如果发送动作最终没有触发请求，下面会提前抛错；预先挂接处理器，
        // 避免后台 waitForResponse 超时形成未处理的 Promise rejection。
        void responsePromise.catch(() => { });

        // 5. 发送提示词。先确认网页确实发出了 conversation POST；如果 Enter
        // 被残留菜单或网页状态吞掉，再点击可见发送按钮，避免空等完整请求超时。
        logger.debug('适配器', '发送提示词...', meta);
        const requestDiagnostics = [];
        const responseDiagnostics = [];
        const requestDiagnosticListener = (request) => {
            const url = request.url();
            if (request.method() === 'POST' && /backend-api|conversation/i.test(url)) {
                try {
                    requestDiagnostics.push({
                        method: request.method(),
                        path: new URL(url).pathname,
                        query: new URL(url).search ? 'present' : 'none'
                    });
                } catch {
                    requestDiagnostics.push({ method: request.method(), path: 'unparseable-url' });
                }
            }
        };
        const responseDiagnosticListener = (response) => {
            const url = response.url();
            if (response.request().method() === 'POST' && /backend-api|conversation/i.test(url)) {
                try {
                    const item = {
                        status: response.status(),
                        path: new URL(url).pathname
                    };
                    responseDiagnostics.push(item);
                    if (/\/sentinel\/req$/i.test(item.path)) {
                        void response.json().then((body) => {
                            if (!body || typeof body !== 'object') return;
                            item.keys = Object.keys(body).slice(0, 20);
                            item.hasToken = Boolean(body.token || body.sentinel_token || body.requirements_token);
                            item.powRequired = Boolean(body.proofofwork?.required);
                            item.turnstileRequired = Boolean(body.turnstile?.required);
                            item.error = typeof body.error === 'string' ? body.error.slice(0, 120) : undefined;
                        }).catch(() => { });
                    }
                } catch {
                    responseDiagnostics.push({ status: response.status(), path: 'unparseable-url' });
                }
            }
        };
        page.on('request', requestDiagnosticListener);
        page.on('response', responseDiagnosticListener);
        const isConversationPost = (request) =>
            request.method() === 'POST' && /\/backend-api\/(?:f\/)?conversation(?:[/?#]|$)/i.test(request.url());
        const waitForSubmission = (timeout = 4000) => page.waitForRequest(isConversationPost, { timeout })
            .then(() => true)
            .catch(() => false);
        const trySubmission = async (action, timeout = 4000) => {
            const submission = waitForSubmission(timeout);
            await action();
            return submission;
        };
        let submitted = await trySubmission(
            () => page.locator(INPUT_SELECTOR).press('Enter').catch(() => page.keyboard.press('Enter'))
        );

        // ChatGPT now performs a Sentinel anti-abuse request before the actual
        // conversation POST. It may solve the browser challenge asynchronously;
        // do not fire duplicate submissions while that request is in flight.
        const sentinelPending = () => requestDiagnostics.some(({ path }) => /\/sentinel\//i.test(path));
        if (!submitted) await sleep(500, 700);
        if (!submitted && sentinelPending()) {
            logger.info('适配器', '检测到 Sentinel 前置请求，等待网页完成挑战后再观察会话请求...', meta);
            submitted = await waitForSubmission(Math.min(waitTimeout, 90000));
        }

        if (!submitted) {
            logger.warn('适配器', '编辑器 Enter 未触发请求，尝试键盘回退...', meta);
            submitted = await trySubmission(() => page.keyboard.press('Enter'));
        }

        if (!submitted) {
            logger.warn('适配器', 'Enter 未触发请求，尝试发送按钮回退...', meta);
            const sendCandidates = [
                page.locator('[data-testid="send-button"]'),
                sendBtnLocator,
                page.getByRole('button', { name: /Send prompt|Send message|发送提示|发送消息/i })
            ];
            let visibleSendButton = null;
            for (const candidate of sendCandidates) {
                const count = Math.min(await candidate.count().catch(() => 0), 5);
                for (let index = 0; index < count; index++) {
                    const button = candidate.nth(index);
                    if (await button.isVisible().catch(() => false) && await button.isEnabled().catch(() => false)) {
                        visibleSendButton = button;
                        break;
                    }
                }
                if (visibleSendButton) break;
            }

            if (visibleSendButton) {
                submitted = await trySubmission(() => visibleSendButton.click({ timeout: 5000 }));
            } else {
                await safeClick(page, INPUT_SELECTOR, { bias: 'input', timeout: 5000 }).catch(() => { });
                submitted = await trySubmission(() => page.keyboard.press('Enter'));
                // A disabled/renamed accessible button can still expose the
                // stable data-testid. Force-click only after Enter produced no
                // request, so this cannot duplicate a successful submission.
                if (!submitted) {
                    submitted = await trySubmission(() => page.locator('[data-testid="send-button"], button[type="submit"]')
                        .first()
                        .click({ force: true, timeout: 3000 })
                        .catch(() => { }));
                }
            }
        }

        if (!submitted) {
            page.off('request', requestDiagnosticListener);
            page.off('response', responseDiagnosticListener);
            await sleep(300, 400);
            const pageState = await page.evaluate(() => {
                const bodyText = document.body?.innerText || '';
                return {
                    url: location.href,
                    title: document.title,
                    hasLoginText: /\blog in\b|登录/i.test(bodyText),
                    hasTurnstileText: /turnstile|cloudflare|人机验证|验证/i.test(bodyText),
                    hasRateLimitText: /rate limit|限额|too many requests|请求过多/i.test(bodyText),
                    hasErrorText: /something went wrong|出错|错误/i.test(bodyText)
                };
            }).catch(() => null);
            logger.warn('适配器', '未观察到会话请求，记录候选网络路径', {
                ...meta,
                requestDiagnostics: requestDiagnostics.slice(-12),
                responseDiagnostics: responseDiagnostics.slice(-12),
                pageState
            });
            throw new Error('发送提示词失败：网页未发出 conversation 请求');
        }
        page.off('request', requestDiagnosticListener);
        page.off('response', responseDiagnosticListener);

        logger.info('适配器', '等待生成结果...', meta);

        // 6. 等待 SSE 响应完成
        try {
            await responsePromise;
        } catch (e) {
            const pageError = normalizePageError(e, meta);
            if (pageError) return pageError;
            throw e;
        }

        // ChatGPT 网页有时先把首个 SSE delta 标记为完成，后续 XML envelope 只在 DOM 中完整呈现。
        // Agent 路径遇到未闭合 envelope 时必须走 DOM 回退，否则解析器会看到截断的前缀。
        const needsAgentEnvelopeRecovery = meta.agentMode === true &&
            /<(?:agent_tool_call|tool_call|tool_use|gemini_function_call)\b/i.test(textContent) &&
            !/<\/(?:agent_tool_call|tool_call|tool_use|gemini_function_call)\s*>/i.test(textContent);
        if (meta.agentMode === true || !textContent || textContent.trim() === '' || needsAgentEnvelopeRecovery) {
            logger.warn('适配器', 'SSE 未解析到文本，尝试 DOM 回退提取...', {
                ...meta,
                ...(agentSseDiagnostics ? {
                    agentSseDiagnostics: {
                        ...summarizeAgentSse(),
                        envelopeRecovery: needsAgentEnvelopeRecovery
                    }
                } : {})
            });
            try {
                // An empty final SSE message is a transient transport result,
                // not evidence that the model is still generating. Keep the
                // empty-DOM probe bounded so the orchestrator can perform its
                // own safe retry before the caller's agent timeout expires.
                const domWaitTimeout = meta.agentMode === true && !textContent.trim() && !needsAgentEnvelopeRecovery
                    ? Math.min(waitTimeout, 8000)
                    : Math.min(waitTimeout, 60000);
                const extractAssistantText = () => {
                    const rejectExact = new Set(['Thinking', 'Instant', 'Pro', 'ChatGPT']);
                    const clean = (value) => (value || '')
                        .replace(/^ChatGPT said:\s*/i, '')
                        .replace(/\u00a0/g, ' ')
                        .trim();
                    const acceptable = (value) => {
                        const text = clean(value);
                        if (!text || rejectExact.has(text)) return '';
                        if (/^(Thinking|Instant|Pro)\s*$/i.test(text)) return '';
                        if (/^\d+\s*\/\s*\d+$/.test(text)) return '';
                        return text;
                    };

                    const nodes = Array.from(document.querySelectorAll('[data-message-author-role="assistant"]'));
                    let best = '';
                    for (let i = nodes.length - 1; i >= 0; i--) {
                        const node = nodes[i];
                        const candidates = [
                            ...Array.from(node.querySelectorAll('.markdown, .prose, [data-message-content-part]'))
                                .map(item => item.innerText || item.textContent || ''),
                            node.innerText || node.textContent || ''
                        ];
                        for (const candidate of candidates) {
                            const lines = clean(candidate)
                                .split('\n')
                                .map(line => clean(line))
                                .filter(Boolean)
                                .filter(line => !rejectExact.has(line));
                            const text = acceptable(lines.join('\n'));
                            // React/ChatGPT 偶尔同时保留首个短 delta 和完整 markdown
                            // 节点；选择同一 assistant 消息中最长的可接受文本，避免
                            // 以短首帧覆盖后续 UUID、exit code 或闭合 envelope。
                            if (text && text.length > best.length) best = text;
                        }
                    }
                    return best;
                };

                const isGenerating = () => {
                    const text = document.body.innerText || '';
                    if (/Thinking\.\.\.|Thinking…|正在思考|思考中/.test(text)) return true;
                    const buttons = Array.from(document.querySelectorAll('button'));
                    return buttons.some((button) => {
                        const label = `${button.getAttribute('aria-label') || ''} ${button.innerText || button.textContent || ''}`;
                        return /stop generating|stop streaming|停止生成|停止回答|cancel/i.test(label);
                    });
                };

                let domText = '';
                const isCompleteAgentEnvelope = (value) => /<(?:agent_tool_call|tool_call|tool_use|gemini_function_call)\b[\s\S]*<\/(?:agent_tool_call|tool_call|tool_use|gemini_function_call)\s*>/i.test(value || '');
                if (meta.agentMode === true) {
                    // 多数情况下 DOM 已经有完整 envelope；先立即读取，避免无谓等待 60 秒。
                    domText = await page.evaluate(extractAssistantText).catch(() => '');
                }

                // A plain final answer can arrive as a short first DOM delta even
                // when the page is still generating.  Envelope recovery already
                // waits for a complete tag; apply the same stability wait to
                // every non-envelope Agent answer so continuations do not lose
                // UUIDs, exit codes, or other suffixes.
                const needsStableAgentText = meta.agentMode === true && !isCompleteAgentEnvelope(domText);
                if (!domText || needsAgentEnvelopeRecovery || needsStableAgentText) {
                    await page.waitForFunction(extractAssistantText, null, { timeout: domWaitTimeout }).catch(() => { });

                    let lastText = domText || '';
                    let stableCount = 0;
                    const stableStartedAt = Date.now();
                    while (Date.now() - stableStartedAt < domWaitTimeout) {
                        const currentText = await page.evaluate(extractAssistantText);
                        const generating = await page.evaluate(isGenerating).catch(() => false);
                        if (currentText && currentText === lastText && !generating) {
                            stableCount++;
                        } else {
                            stableCount = 0;
                            lastText = currentText || lastText || '';
                        }

                        if (lastText && !generating && stableCount >= 8) {
                            domText = lastText;
                            break;
                        }

                        await sleep(1200, 1600);
                    }

                    if (!domText) {
                        domText = lastText || await page.evaluate(extractAssistantText);
                    }
                }

                if (domText && domText.trim() && (
                    needsAgentEnvelopeRecovery ||
                    !textContent.trim() ||
                    (meta.agentMode === true && isCompleteAgentEnvelope(domText))
                )) {
                    textContent = domText.trim();
                    logger.info('适配器', `DOM 回退提取文本成功 (${textContent.length} 字符)`, meta);
                }
            } catch (e) {
                logger.warn('适配器', `DOM 回退提取失败: ${e.message}`, meta);
            }
        }

        if (!textContent || textContent.trim() === '') {
            logger.warn('适配器', '回复内容为空', {
                ...meta,
                ...(agentSseDiagnostics ? { agentSseDiagnostics: summarizeAgentSse() } : {})
            });
            return { error: '回复内容为空' };
        }

        logger.info('适配器', `已获取文本内容 (${textContent.length} 字符)`, meta);
        logger.info('适配器', '文本生成完成，任务完成', meta);
        return { text: textContent.trim() };

    } catch (err) {
        // 顶层错误处理
        const pageError = normalizePageError(err, meta);
        if (pageError) return pageError;

        logger.error('适配器', '生成任务失败', { ...meta, error: err.message });
        return { error: `生成任务失败: ${err.message}` };
    } finally { }
}

/**
 * 适配器 manifest
 */
export const manifest = {
    id: 'chatgpt_text',
    displayName: 'ChatGPT (文本生成)',
    description: '使用 ChatGPT 官网生成文本，支持多模型切换和图片上传。需要已登录的 ChatGPT 账户，若需要选择模型，请使用会员账号 (包含 K12 教室认证账号)。',

    // 配置项模式
    configSchema: [
        {
            key: 'temporaryChat',
            label: '临时对话',
            type: 'boolean',
            default: false,
            note: '开启后将使用临时对话模式 (?temporary-chat=true)'
        }
    ],

    // 入口 URL
    getTargetUrl(config, workerConfig) {
        const useTemp = config?.backend?.adapter?.chatgpt_text?.temporaryChat || false;
        return useTemp ? 'https://chatgpt.com/?temporary-chat=true' : 'https://chatgpt.com/';
    },

    // 模型列表
    models: [
        { id: 'gpt-instant', codeName: 'Instant', imagePolicy: 'optional', type: 'text' },
        { id: 'gpt-thinking', codeName: 'Thinking', imagePolicy: 'optional', type: 'text' },
        { id: 'gpt-pro', codeName: 'Pro', imagePolicy: 'optional', type: 'text' }
    ],

    // 无需导航处理器
    navigationHandlers: [],

    // 核心文本生成方法
    generate
};
