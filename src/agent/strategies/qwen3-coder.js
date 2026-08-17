import { createEnvelopeNonce } from '../ir/ids.js';
import { buildSyntheticPrompt, renderToolsJson } from '../prompts/base.js';

function renderQwen3CoderTools(tools) {
    return renderToolsJson(tools).map(tool => JSON.stringify({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters
    })).join('\n');
}

export const qwen3CoderStrategy = {
    id: 'qwen3_coder',
    parserId: 'qwen3_coder',
    kind: 'synthetic',
    render(request, options = {}) {
        const nonce = createEnvelopeNonce();
        return {
            prompt: buildSyntheticPrompt(request, {
                nonce,
                toolsTag: 'tools',
                toolResultTag: 'tool_response',
                maxInstructionChars: options.config?.agentCompatibility?.maxSyntheticInstructionChars,
                renderToolDefinition: renderQwen3CoderTools,
                toolInstructions: [
                    'Use the Qwen3-Coder tool-call format.',
                    '<tool_call>\n{"name":"tool_name","arguments":{}}\n</tool_call>',
                    'For a tool call, output no suffix after the closing tag.',
                    'The arguments field must be an object, not a string. Multiple calls are allowed only when parallel_tool_calls is true.'
                ].join('\n')
            }),
            nonce,
            strategyId: this.id,
            parserId: this.parserId,
            providerOpaqueState: null
        };
    }
};
