import { createEnvelopeNonce } from '../ir/ids.js';
import { buildSyntheticPrompt } from '../prompts/base.js';

export const geminiSyntheticStrategy = {
    id: 'gemini_synthetic',
    parserId: 'gemini_synthetic',
    kind: 'synthetic',
    render(request, options = {}) {
        const nonce = createEnvelopeNonce();
        return {
            prompt: buildSyntheticPrompt(request, {
                nonce,
                toolsTag: 'function_declarations',
                toolResultTag: 'function_response',
                maxInstructionChars: options.config?.agentCompatibility?.maxSyntheticInstructionChars,
                toolInstructions: [
                    'Use the Gemini-style function envelope below for external Agent tools.',
                    `<gemini_function_call nonce="${nonce}">{"name":"tool_name","args":{}}</gemini_function_call>`,
                    'The args value must be an object. Do not claim that a function was executed.',
                    'Preserve any provider thought signature as opaque state; never invent one.'
                ].join('\n')
            }),
            nonce,
            strategyId: this.id,
            parserId: this.parserId,
            providerOpaqueState: null
        };
    }
};
