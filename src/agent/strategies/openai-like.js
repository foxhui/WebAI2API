import { createEnvelopeNonce } from '../ir/ids.js';
import { buildSyntheticPrompt } from '../prompts/base.js';

export const openAILikeSyntheticStrategy = {
    id: 'openai_like_synthetic',
    parserId: 'openai_style_synthetic',
    kind: 'synthetic',
    render(request, options = {}) {
        const nonce = createEnvelopeNonce();
        return {
            prompt: buildSyntheticPrompt(request, {
                nonce,
                toolsTag: 'agent_tools',
                toolResultTag: 'agent_tool_result',
                maxInstructionChars: options.config?.agentCompatibility?.maxSyntheticInstructionChars,
                toolInstructions: [
                    'Use this exact envelope when calling a tool:',
                    `<agent_tool_call nonce="${nonce}">{"name":"tool_name","arguments":{}}</agent_tool_call>`,
                    'Do not invent a call_id; the external compatibility layer assigns a collision-safe ID.',
                    'The arguments value must be a JSON object, never a JSON string.',
                    'If a tool result reports an error, inspect the evidence and call the next tool needed to finish the user request; do not give up after the first failure.',
                    'You may emit multiple adjacent envelopes only when parallel_tool_calls is true.'
                ].join('\n')
            }),
            nonce,
            strategyId: this.id,
            parserId: this.parserId,
            providerOpaqueState: null
        };
    }
};
