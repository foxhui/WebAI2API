import { createEnvelopeNonce } from '../ir/ids.js';
import { buildSyntheticPrompt } from '../prompts/base.js';

export const anthropicSyntheticStrategy = {
    id: 'anthropic_synthetic',
    parserId: 'anthropic_synthetic',
    kind: 'synthetic',
    render(request, options = {}) {
        const nonce = createEnvelopeNonce();
        return {
            prompt: buildSyntheticPrompt(request, {
                nonce,
                toolsTag: 'tools',
                toolResultTag: 'tool_result',
                maxInstructionChars: options.config?.agentCompatibility?.maxSyntheticInstructionChars,
                toolInstructions: [
                    'Use an Anthropic-like external tool envelope.',
                    `<tool_use nonce="${nonce}">{"name":"tool_name","input":{}}</tool_use>`,
                    'Do not invent an id; the external compatibility layer assigns a collision-safe ID.',
                    'The input value must be a JSON object and no prose may follow a tool_use envelope.'
                ].join('\n')
            }),
            nonce,
            strategyId: this.id,
            parserId: this.parserId,
            providerOpaqueState: null
        };
    }
};
