import { AgentError, AGENT_ERROR_CODES } from './errors.js';
import { validateAssistantTurn } from './state-machine.js';
import { parseToolOutput } from '../parsers/index.js';
import { selectToolStrategy } from '../strategies/index.js';
import { contentPartsToText } from '../ir/content-parts.js';

function toolMapFromRequest(request) {
    return new Map((request.tools || []).map(tool => [tool.name, tool]));
}

function assistantText(turn) {
    return (turn.items || [])
        .filter(item => item.type === 'message')
        .map(item => contentPartsToText(item.content))
        .join('');
}

function providerRequestForCompatibility(request, strategy, config = {}) {
    const forceInitialToolChoice = config.agentCompatibility?.forceInitialToolChoice === true;
    const forceInitialToolName = config.agentCompatibility?.forceInitialToolName;
    const forcedTurns = Number(config.agentCompatibility?.forceSyntheticToolChoiceTurns || 0);
    const completedToolCalls = (request.items || []).filter(item => item.type === 'tool_call').length;
    const forceInitialTurn = forceInitialToolChoice && completedToolCalls === 0;
    // A bounded continuation policy must not force the very first turn when
    // `forceInitialToolChoice` is disabled: the model needs to choose its
    // natural first tool. Once a real result exists, forcing the next tool
    // keeps synthetic providers from prematurely closing the loop.
    const forceBoundedTurn = Number.isInteger(forcedTurns) &&
        completedToolCalls > 0 &&
        forcedTurns > completedToolCalls;
    if (
        strategy.kind === 'synthetic' &&
        (forceInitialTurn || forceBoundedTurn) &&
        request.toolChoice?.mode === 'auto' &&
        (request.tools || []).length > 0
    ) {
        // Preserve the client's AUTO choice in the IR/response, but make the
        // first synthetic provider turn deterministic for models that often
        // answer with refusal prose instead of emitting the requested tool.
        const namedTool = forceInitialTurn && typeof forceInitialToolName === 'string' &&
            (request.tools || []).some(tool => tool.name === forceInitialToolName)
            ? { mode: 'function', name: forceInitialToolName }
            : { mode: 'required' };
        return { ...request, toolChoice: namedTool };
    }
    return request;
}

function effectiveValidationRequest(request, execution) {
    const providerChoice = execution?.execution?.providerToolChoice;
    if (
        execution?.execution?.kind === 'synthetic' &&
        request.toolChoice?.mode === 'auto' &&
        providerChoice &&
        (providerChoice.mode === 'required' || providerChoice.mode === 'function')
    ) {
        // Keep the public IR in AUTO, but validate an opt-in forced provider turn
        // as required. Otherwise a provider can return refusal prose and the
        // compatibility layer would incorrectly present it as a successful turn.
        return { ...request, toolChoice: providerChoice };
    }
    return request;
}

function syntheticRetryLimit(config = {}) {
    const value = Number(config.agentCompatibility?.maxSyntheticToolRetries || 0);
    if (!Number.isInteger(value) || value <= 0) return 0;
    return Math.min(value, 3);
}

function isRetryableSyntheticChoice(request, execution, config = {}) {
    return (
        execution?.execution?.kind === 'synthetic' &&
        request.toolChoice?.mode === 'auto' &&
        ((execution.execution.providerToolChoice?.mode === 'required' ||
            execution.execution.providerToolChoice?.mode === 'function') ||
            config.agentCompatibility?.retrySyntheticAutoFinal === true) &&
        syntheticRetryLimit(config) > 0
    );
}

function isSyntheticAutoFinal(request, execution, parsed) {
    return (
        execution?.execution?.kind === 'synthetic' &&
        request.toolChoice?.mode === 'auto' &&
        execution.execution.providerToolChoice?.mode === 'auto' &&
        (request.items || []).every(item => item.type !== 'tool_call') &&
        (parsed?.agentTurn?.items || []).length > 0 &&
        (parsed.agentTurn.items || []).every(item => item.type === 'message')
    );
}

function isRetryableSyntheticProviderError(providerResult) {
    const message = String(providerResult?.error || '');
    return /回复内容为空|empty response|response content empty/i.test(message);
}

function buildSyntheticRetryPrompt(prompt, execution, attempt) {
    const providerChoice = execution.execution.providerToolChoice;
    const requiredTool = providerChoice.mode === 'function'
        ? `the exact declared tool ${providerChoice.name}`
        : 'one declared tool';
    return [
        prompt,
        '',
        `[compatibility protocol retry ${attempt}]`,
        'The previous provider output was rejected because it returned final prose without a real tool envelope.',
        'Restart this same turn; this retry is not a user-facing answer.',
        `Tool choice is still REQUIRED: emit exactly one provider-specific tool envelope for ${requiredTool} now.`,
        'Your next response must start with the opening tool tag and end with its closing tag.',
        'Do not emit a plan, refusal, progress sentence, simulated JSON, or any text before or after the envelope.',
        'Use the exact envelope format and nonce already declared above.'
    ].join('\n');
}

export function prepareAgentExecution(request, options = {}) {
    const strategy = selectToolStrategy({
        adapterId: options.adapterId,
        modelId: options.modelId || request.model,
        route: options.route || request.metadata?.route,
        config: options.config,
        capabilityOverride: options.capabilityOverride
    });
    const expected = request.metadata?.expectedExecution;
    if (expected?.strategyId && expected.strategyId !== strategy.id) {
        throw new AgentError(
            AGENT_ERROR_CODES.RESPONSE_STRATEGY_MISMATCH,
            `previous_response_id requires strategy ${expected.strategyId}, but ${strategy.id} was selected`
        );
    }

    const providerRequest = providerRequestForCompatibility(request, strategy, options.config);
    const rendered = strategy.render(providerRequest, {
        adapterId: options.adapterId,
        modelId: options.modelId || request.model,
        route: options.route || request.metadata?.route,
        config: options.config
    });
    const execution = {
        adapterId: options.adapterId,
        modelId: options.modelId || request.model,
        route: options.route || request.metadata?.route,
        strategyId: strategy.id,
        parserId: strategy.parserId,
        kind: strategy.kind,
        providerOpaqueState: rendered.providerOpaqueState || null,
        providerToolChoice: providerRequest.toolChoice
    };
    return {
        strategy,
        prompt: rendered.prompt,
        nativeRequest: rendered.nativeRequest || null,
        nonce: rendered.nonce || null,
        execution
    };
}

export function parseAgentProviderResult(request, execution, providerResult, options = {}) {
    const validationRequest = effectiveValidationRequest(request, execution);
    if (providerResult?.agentTurn) {
        const validated = validateAssistantTurn(validationRequest, providerResult.agentTurn);
        return {
            ...providerResult,
            agentTurn: validated,
            agentExecution: execution.execution
        };
    }

    const providerOutput = providerResult?.nativeAgentOutput ?? providerResult?.text ?? '';
    let turn;
    try {
        turn = parseToolOutput(execution.strategy.parserId, providerOutput, {
            nonce: execution.nonce,
            toolMap: toolMapFromRequest(request),
            request,
            generateCallIds: execution.strategy.kind === 'synthetic'
        });
    } catch (error) {
        if (error instanceof AgentError) throw error;
        throw new AgentError(
            AGENT_ERROR_CODES.PROVIDER_PARSE_FAILED,
            `Provider output parser failed: ${error.message}`
        );
    }

    if (providerResult?.reasoning && !turn.reasoning) {
        turn.reasoning = providerResult.reasoning;
    }
    const validated = validateAssistantTurn(validationRequest, turn);
    return {
        ...providerResult,
        text: assistantText(validated),
        agentTurn: validated,
        agentExecution: execution.execution
    };
}

export async function executeAgentRequest(context, request, options = {}) {
    const execution = prepareAgentExecution(request, options);
    const retryable = isRetryableSyntheticChoice(request, execution, options.config);
    const retryLimit = syntheticRetryLimit(options.config);
    let prompt = execution.prompt;

    for (let attempt = 0; ; attempt++) {
        const providerResult = await options.generate(
            context,
            prompt,
            options.imagePaths || [],
            options.modelId || request.model,
            {
                ...(options.meta || {}),
                agentMode: true,
                agentStrategy: execution.execution.strategyId,
                agentParser: execution.execution.parserId,
                agentNativeRequest: execution.nativeRequest,
                ...(attempt > 0 ? { agentProtocolRetry: attempt } : {})
            }
        );
        if (providerResult?.error) {
            // A browser-backed synthetic adapter can observe a completed SSE
            // response whose final message is empty. No tool was emitted or
            // executed in that case, so a bounded protocol retry is safe and
            // avoids surfacing a transient blank turn as a completed agent run.
            if (
                retryable &&
                isRetryableSyntheticProviderError(providerResult) &&
                attempt < retryLimit
            ) {
                prompt = buildSyntheticRetryPrompt(execution.prompt, execution, attempt + 1);
                continue;
            }
            return { ...providerResult, agentExecution: execution.execution };
        }
        try {
            const parsed = parseAgentProviderResult(request, execution, providerResult, options);
            if (
                retryable &&
                isSyntheticAutoFinal(request, execution, parsed) &&
                attempt < retryLimit
            ) {
                prompt = buildSyntheticRetryPrompt(execution.prompt, execution, attempt + 1);
                continue;
            }
            return parsed;
        } catch (error) {
            const retryableProtocolError = new Set([
                AGENT_ERROR_CODES.TOOL_CALL_REQUIRED,
                AGENT_ERROR_CODES.MALFORMED_TOOL_CALL,
                AGENT_ERROR_CODES.TOOL_CALL_NONCE_MISMATCH,
                AGENT_ERROR_CODES.PROVIDER_PARSE_FAILED
            ]);
            if (
                retryable &&
                retryableProtocolError.has(error?.code) &&
                attempt < retryLimit
            ) {
                prompt = buildSyntheticRetryPrompt(execution.prompt, execution, attempt + 1);
                continue;
            }
            throw error;
        }
    }
}
