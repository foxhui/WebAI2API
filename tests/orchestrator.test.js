import assert from 'node:assert/strict';
import test from 'node:test';

import {
    executeAgentRequest,
    normalizeToolDefinitions,
    prepareAgentExecution
} from '../src/agent/index.js';
import { buildSyntheticPrompt } from '../src/agent/prompts/base.js';

const tools = normalizeToolDefinitions([{
    type: 'function',
    name: 'read_file',
    description: 'Read a file',
    parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
        additionalProperties: false
    }
}]);

function request(model = 'gpt-instant') {
    return {
        requestId: 'orchestrator-test',
        protocol: 'openai_chat',
        model,
        instructions: [],
        items: [{ type: 'message', role: 'user', content: [{ type: 'text', text: 'read' }] }],
        tools,
        toolChoice: { mode: 'auto' },
        parallelToolCalls: false,
        stream: false,
        metadata: { route: '/v1/chat/completions' }
    };
}

test('orchestrator chooses the strategy after adapter/model selection and parses output', async () => {
    const prepared = prepareAgentExecution(request(), {
        adapterId: 'chatgpt_text',
        modelId: 'gpt-instant',
        config: { agentCompatibility: { enabled: true } }
    });
    assert.equal(prepared.execution.strategyId, 'openai_like_synthetic');
    assert.match(prepared.prompt, /agent_tools/);

    const result = await executeAgentRequest(null, request(), {
        adapterId: 'chatgpt_text',
        modelId: 'gpt-instant',
        config: { agentCompatibility: { enabled: true } },
        generate: async (_context, prompt) => ({
            text: `<agent_tool_call nonce="${prompt.match(/agent_tools nonce="([^"]+)"/)?.[1]}">{"name":"read_file","arguments":{"path":"package.json"}}</agent_tool_call>`
        })
    });
    assert.equal(result.agentTurn.items[0].name, 'read_file');
    assert.match(result.agentTurn.items[0].callId, /^call_[a-f0-9]{32}$/);
    assert.equal(result.agentExecution.parserId, 'openai_style_synthetic');
});

test('synthetic provider call IDs are replaced at the compatibility boundary', async () => {
    const result = await executeAgentRequest(null, request(), {
        adapterId: 'chatgpt_text',
        modelId: 'gpt-instant',
        config: { agentCompatibility: { enabled: true } },
        generate: async (_context, prompt) => ({
            text: `<agent_tool_call nonce="${prompt.match(/agent_tools nonce="([^"]+)"/)?.[1]}">{"call_id":"call_unique_id","name":"read_file","arguments":{"path":"package.json"}}</agent_tool_call>`
        })
    });
    assert.match(result.agentTurn.items[0].callId, /^call_[a-f0-9]{32}$/);
    assert.notEqual(result.agentTurn.items[0].callId, 'call_unique_id');
});

test('orchestrator returns final assistant text after a synthetic tool result', async () => {
    const requestWithResult = {
        ...request(),
        items: [
            ...request().items,
            { type: 'tool_call', callId: 'call_previous', name: 'read_file', arguments: { path: 'package.json' } },
            { type: 'tool_result', callId: 'call_previous', name: 'read_file', output: [{ type: 'text', text: '{"ok":true}' }] }
        ]
    };
    const result = await executeAgentRequest(null, requestWithResult, {
        adapterId: 'chatgpt_text',
        modelId: 'gpt-instant',
        config: { agentCompatibility: { enabled: true } },
        generate: async () => ({ text: 'The file was read successfully.' })
    });
    assert.equal(result.text, 'The file was read successfully.');
});

test('orchestrator keeps provider parser errors typed and does not execute tools', async () => {
    let executed = false;
    await assert.rejects(() => executeAgentRequest(null, request(), {
        adapterId: 'chatgpt_text',
        modelId: 'gpt-instant',
        config: { agentCompatibility: { enabled: true } },
        generate: async () => {
            executed = true;
            return { text: '<agent_tool_call>{broken</agent_tool_call>' };
        }
    }), error => error?.code === 'AGENT_MALFORMED_TOOL_CALL');
    assert.equal(executed, true);
});

test('synthetic prompt honors normalized tool choice and continuation state', () => {
    const prompt = buildSyntheticPrompt({
        ...request(),
        toolChoice: { mode: 'required' },
        items: [
            ...request().items,
            { type: 'tool_call', callId: 'call_previous', name: 'read_file', arguments: { path: 'package.json' } },
            { type: 'tool_result', callId: 'call_previous', name: 'read_file', output: [{ type: 'text', text: 'ok' }] }
        ]
    }, { nonce: 'nonce_prompt_test' });

    assert.match(prompt, /Tool choice is REQUIRED/);
    assert.doesNotMatch(prompt, /Tool choice is AUTO/);
    assert.match(prompt, /continuation turn after one or more real external tool results/i);
    assert.match(prompt, /emit the next declared tool envelope now/i);
});

test('synthetic prompts bound oversized provider instructions while keeping task items', () => {
    const prompt = buildSyntheticPrompt({
        ...request(),
        instructions: [{
            role: 'system',
            content: [{ type: 'text', text: `${'head '.repeat(2500)}TAIL_MARKER` }]
        }],
        items: [{ type: 'message', role: 'user', content: [{ type: 'text', text: 'TASK_MARKER' }] }]
    }, { nonce: 'nonce_bound_prompt', maxInstructionChars: 1000 });

    assert.ok(prompt.length < 5000);
    assert.match(prompt, /system instruction truncated/i);
    assert.match(prompt, /TASK_MARKER/);
    assert.match(prompt, /TAIL_MARKER/);
});

test('optional synthetic first-turn forcing preserves the client AUTO IR choice', () => {
    const prepared = prepareAgentExecution(request(), {
        adapterId: 'chatgpt_text',
        modelId: 'gpt-instant',
        config: { agentCompatibility: { enabled: true, forceInitialToolChoice: true } }
    });
    assert.match(prepared.prompt, /Tool choice is REQUIRED/);
    assert.equal(prepared.execution.providerToolChoice.mode, 'required');

    const normal = prepareAgentExecution(request(), {
        adapterId: 'chatgpt_text',
        modelId: 'gpt-instant',
        config: { agentCompatibility: { enabled: true } }
    });
    assert.match(normal.prompt, /Tool choice is AUTO/);
    assert.equal(normal.execution.providerToolChoice.mode, 'auto');

    const named = prepareAgentExecution(request(), {
        adapterId: 'chatgpt_text',
        modelId: 'gpt-instant',
        config: {
            agentCompatibility: {
                enabled: true,
                forceInitialToolChoice: true,
                forceInitialToolName: 'read_file'
            }
        }
    });
    assert.match(named.prompt, /exact tool name: read_file/i);
    assert.deepEqual(named.execution.providerToolChoice, { mode: 'function', name: 'read_file' });

    const continuation = {
        ...request(),
        items: [
            ...request().items,
            { type: 'tool_call', callId: 'call_previous', name: 'read_file', arguments: { path: 'package.json' } },
            { type: 'tool_result', callId: 'call_previous', name: 'read_file', output: [{ type: 'text', text: 'ok' }] }
        ]
    };
    const bounded = prepareAgentExecution(continuation, {
        adapterId: 'chatgpt_text',
        modelId: 'gpt-instant',
        config: {
            agentCompatibility: {
                enabled: true,
                forceInitialToolName: 'read_file',
                forceSyntheticToolChoiceTurns: 2
            }
        }
    });
    assert.equal(bounded.execution.providerToolChoice.mode, 'required');

    const continuationOnly = prepareAgentExecution(request(), {
        adapterId: 'chatgpt_text',
        modelId: 'gpt-instant',
        config: {
            agentCompatibility: {
                enabled: true,
                forceInitialToolChoice: false,
                forceSyntheticToolChoiceTurns: 2
            }
        }
    });
    assert.equal(continuationOnly.execution.providerToolChoice.mode, 'auto');

    const namedInitial = prepareAgentExecution(request(), {
        adapterId: 'chatgpt_text',
        modelId: 'gpt-instant',
        config: {
            agentCompatibility: {
                enabled: true,
                forceInitialToolChoice: true,
                forceInitialToolName: 'read_file',
                forceSyntheticToolChoiceTurns: 2
            }
        }
    });
    assert.deepEqual(namedInitial.execution.providerToolChoice, { mode: 'function', name: 'read_file' });

    const afterBound = prepareAgentExecution({
        ...continuation,
        items: [
            ...continuation.items,
            { type: 'tool_call', callId: 'call_two', name: 'read_file', arguments: { path: 'package.json' } },
            { type: 'tool_result', callId: 'call_two', name: 'read_file', output: [{ type: 'text', text: 'ok' }] }
        ]
    }, {
        adapterId: 'chatgpt_text',
        modelId: 'gpt-instant',
        config: { agentCompatibility: { enabled: true, forceSyntheticToolChoiceTurns: 2 } }
    });
    assert.equal(afterBound.execution.providerToolChoice.mode, 'auto');
});

test('bounded synthetic forcing retries a final provider turn without fabricating a call', async () => {
    let attempts = 0;
    const result = await executeAgentRequest(null, request(), {
        adapterId: 'chatgpt_text',
        modelId: 'gpt-instant',
        config: {
            agentCompatibility: {
                enabled: true,
                forceInitialToolChoice: true,
                maxSyntheticToolRetries: 1
            }
        },
        generate: async (_context, prompt) => {
            attempts++;
            if (attempts === 1) return { text: 'I will use the tool now.' };
            return {
                text: `<agent_tool_call nonce="${prompt.match(/agent_tools nonce="([^"]+)"/)?.[1]}">{"name":"read_file","arguments":{"path":"package.json"}}</agent_tool_call>`
            };
        }
    });
    assert.equal(attempts, 2);
    assert.equal(result.agentTurn.items[0].name, 'read_file');
});

test('optional AUTO compatibility retry nudges a premature final without fabricating a call', async () => {
    let attempts = 0;
    const result = await executeAgentRequest(null, request(), {
        adapterId: 'chatgpt_text',
        modelId: 'gpt-instant',
        config: {
            agentCompatibility: {
                enabled: true,
                retrySyntheticAutoFinal: true,
                maxSyntheticToolRetries: 1
            }
        },
        generate: async (_context, prompt) => {
            attempts++;
            if (attempts === 1) return { text: 'I cannot access the external tool.' };
            return {
                text: `<agent_tool_call nonce="${prompt.match(/agent_tools nonce="([^\"]+)"/)?.[1]}">{"name":"read_file","arguments":{"path":"package.json"}}</agent_tool_call>`
            };
        }
    });
    assert.equal(attempts, 2);
    assert.equal(result.agentTurn.items[0].name, 'read_file');
});

test('synthetic compatibility retries an empty browser response before surfacing an error', async () => {
    let attempts = 0;
    const result = await executeAgentRequest(null, request(), {
        adapterId: 'chatgpt_text',
        modelId: 'gpt-instant',
        config: {
            agentCompatibility: {
                enabled: true,
                retrySyntheticAutoFinal: true,
                maxSyntheticToolRetries: 1
            }
        },
        generate: async (_context, prompt) => {
            attempts++;
            if (attempts === 1) return { error: '回复内容为空' };
            return {
                text: `<agent_tool_call nonce="${prompt.match(/agent_tools nonce="([^\"]+)"/)?.[1]}">{"name":"read_file","arguments":{"path":"package.json"}}</agent_tool_call>`
            };
        }
    });
    assert.equal(attempts, 2);
    assert.equal(result.agentTurn.items[0].name, 'read_file');
});

test('bounded synthetic forcing fails closed after retry exhaustion', async () => {
    let attempts = 0;
    await assert.rejects(() => executeAgentRequest(null, request(), {
        adapterId: 'chatgpt_text',
        modelId: 'gpt-instant',
        config: {
            agentCompatibility: {
                enabled: true,
                forceInitialToolChoice: true,
                maxSyntheticToolRetries: 1
            }
        },
        generate: async () => {
            attempts++;
            return { text: 'I cannot call tools.' };
        }
    }), error => error?.code === 'AGENT_TOOL_CALL_REQUIRED');
    assert.equal(attempts, 2);
});

test('bounded synthetic forcing retries a malformed provider envelope', async () => {
    let attempts = 0;
    const result = await executeAgentRequest(null, request(), {
        adapterId: 'chatgpt_text',
        modelId: 'gpt-instant',
        config: {
            agentCompatibility: {
                enabled: true,
                forceInitialToolChoice: true,
                maxSyntheticToolRetries: 1
            }
        },
        generate: async (_context, prompt) => {
            attempts++;
            if (attempts === 1) {
                return { text: '<agent_tool_call nonce="wrong">{"name":"read_file","arguments":{}}</agent_tool_call>' };
            }
            return {
                text: `<agent_tool_call nonce="${prompt.match(/agent_tools nonce="([^\"]+)"/)?.[1]}">{"name":"read_file","arguments":{"path":"package.json"}}</agent_tool_call>`
            };
        }
    });
    assert.equal(attempts, 2);
    assert.equal(result.agentTurn.items[0].name, 'read_file');
});
