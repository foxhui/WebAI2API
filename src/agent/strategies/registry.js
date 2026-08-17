import { nativePassThroughStrategy } from './native-pass-through.js';
import { openAILikeSyntheticStrategy } from './openai-like.js';
import { qwenHermesStrategy } from './qwen-hermes.js';
import { qwen3CoderStrategy } from './qwen3-coder.js';
import { geminiSyntheticStrategy } from './gemini-like.js';
import { anthropicSyntheticStrategy } from './anthropic-like.js';
import { genericTaggedJsonStrategy } from './generic-tagged-json.js';

const strategies = new Map([
    [openAILikeSyntheticStrategy.id, openAILikeSyntheticStrategy],
    [qwenHermesStrategy.id, qwenHermesStrategy],
    [qwen3CoderStrategy.id, qwen3CoderStrategy],
    [geminiSyntheticStrategy.id, geminiSyntheticStrategy],
    [anthropicSyntheticStrategy.id, anthropicSyntheticStrategy],
    [genericTaggedJsonStrategy.id, genericTaggedJsonStrategy],
    [nativePassThroughStrategy.id, nativePassThroughStrategy]
]);

function modelFamily(modelId) {
    const model = String(modelId || '').toLowerCase();
    if (/(qwen3[-_.]?coder|qwencoder|coder)/i.test(model) && model.includes('qwen')) return 'qwen3_coder';
    if (/(qwen|qwq)/i.test(model)) return 'qwen_hermes';
    if (model.includes('gemini')) return 'gemini';
    if (model.includes('claude') || model.includes('anthropic')) return 'anthropic';
    if (model.includes('gpt') || model.includes('chatgpt') || model.includes('deepseek')) return 'openai_like';
    return 'generic';
}

function syntheticForFamily(family) {
    switch (family) {
        case 'qwen3_coder': return qwen3CoderStrategy;
        case 'qwen_hermes': return qwenHermesStrategy;
        case 'gemini': return geminiSyntheticStrategy;
        case 'anthropic': return anthropicSyntheticStrategy;
        case 'openai_like': return openAILikeSyntheticStrategy;
        default: return genericTaggedJsonStrategy;
    }
}

export function getStrategy(strategyId) {
    return strategies.get(strategyId) || null;
}

export function listStrategies() {
    return [...strategies.keys()];
}

export function selectToolStrategy(options = {}) {
    const {
        adapterId,
        modelId,
        route,
        config = {},
        capabilityOverride
    } = options;
    const override = capabilityOverride || config.agentCompatibility?.capabilityOverrides?.[`${adapterId}/${modelId}`] || config.agentCompatibility?.capabilityOverrides?.[modelId];
    if (override?.strategyId && strategies.has(override.strategyId)) {
        return strategies.get(override.strategyId);
    }

    // Native pass-through is opt-in and only advertised for ZenMux. The adapter must
    // explicitly return native tool metadata before this path is considered complete.
    if (
        adapterId === 'zenmux_ai_text' &&
        config.agentCompatibility?.nativePassThrough === true &&
        override?.native === true
    ) {
        return nativePassThroughStrategy;
    }

    return syntheticForFamily(modelFamily(modelId));
}

export function describeStrategySelection(options = {}) {
    const strategy = selectToolStrategy(options);
    return {
        adapterId: options.adapterId,
        modelId: options.modelId,
        route: options.route,
        strategyId: strategy.id,
        parserId: strategy.parserId,
        kind: strategy.kind
    };
}
