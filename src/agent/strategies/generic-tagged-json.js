import { createEnvelopeNonce } from '../ir/ids.js';
import { buildSyntheticPrompt } from '../prompts/base.js';

export const genericTaggedJsonStrategy = {
    id: 'generic_tagged_json',
    parserId: 'generic_tagged_json',
    kind: 'synthetic',
    render(request, options = {}) {
        const nonce = createEnvelopeNonce();
        return {
            prompt: buildSyntheticPrompt(request, {
                nonce,
                toolsTag: 'tools',
                toolResultTag: 'tool_response',
                maxInstructionChars: options.config?.agentCompatibility?.maxSyntheticInstructionChars,
                toolInstructions: [
                    'Use exactly one or more tagged JSON tool calls when a tool is needed.',
                    `<tool_call nonce="${nonce}">{"name":"tool_name","arguments":{}}</tool_call>`,
                    'Never execute the tool yourself.'
                ].join('\n')
            }),
            nonce,
            strategyId: this.id,
            parserId: this.parserId,
            providerOpaqueState: null
        };
    }
};
