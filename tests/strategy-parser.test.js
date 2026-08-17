import assert from 'node:assert/strict';
import test from 'node:test';

import {
    AGENT_ERROR_CODES,
    describeStrategySelection,
    listStrategies,
    listToolParsers,
    normalizeToolDefinitions,
    parseToolOutput,
    selectToolStrategy
} from '../src/agent/index.js';

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

const request = {
    instructions: [],
    items: [{ type: 'message', role: 'user', content: [{ type: 'text', text: 'read' }] }],
    tools,
    toolChoice: { mode: 'auto' },
    parallelToolCalls: false
};

function parserContext(nonce = 'nonce_test') {
    return { nonce, toolMap: new Map(tools.map(tool => [tool.name, tool])) };
}

test('strategy registry separates transport adapter from model family', () => {
    assert.equal(selectToolStrategy({ adapterId: 'lmarena_text', modelId: 'qwen3-coder-30b' }).id, 'qwen3_coder');
    assert.equal(selectToolStrategy({ adapterId: 'lmarena_text', modelId: 'qwen3-32b' }).id, 'qwen_hermes');
    assert.equal(selectToolStrategy({ adapterId: 'gemini_text', modelId: 'gemini-2.5-flash' }).id, 'gemini_synthetic');
    assert.equal(selectToolStrategy({ adapterId: 'chatgpt_text', modelId: 'gpt-instant' }).id, 'openai_like_synthetic');
    assert.equal(describeStrategySelection({ adapterId: 'zenmux_ai_text', modelId: 'qwen3-32b' }).parserId, 'qwen_hermes');
    assert.ok(listStrategies().includes('native_pass_through'));
});

test('OpenAI-like parser only accepts its exact tagged envelope', () => {
    const result = parseToolOutput('openai_style_synthetic',
        '<agent_tool_call nonce="nonce_test">{"name":"read_file","arguments":{"path":"package.json"}}</agent_tool_call>',
        parserContext());
    assert.equal(result.items[0].callId.startsWith('call_'), true);
    assert.deepEqual(result.items[0].arguments, { path: 'package.json' });

    const ordinaryJson = parseToolOutput('openai_style_synthetic',
        '{"name":"read_file","arguments":{"path":"package.json"}}',
        parserContext());
    assert.equal(ordinaryJson.items[0].type, 'message');
});

test('OpenAI-like parser repairs unescaped backslashes inside string arguments', () => {
    const result = parseToolOutput('openai_style_synthetic',
        String.raw`<agent_tool_call nonce="nonce_test">{"name":"read_file","arguments":{"path":"C:\work\src"}}</agent_tool_call>`,
        parserContext());
    assert.equal(result.items[0].arguments.path, 'C:\\work\\src');
});

test('Qwen Hermes parser supports official object arguments and rejects unknown tools', () => {
    const result = parseToolOutput('qwen_hermes',
        '<tool_call>\n{"name":"read_file","arguments":{"path":"package.json"}}\n</tool_call>',
        parserContext());
    assert.deepEqual(result.items[0].arguments, { path: 'package.json' });
    assert.throws(() => parseToolOutput('qwen_hermes',
        '<tool_call>{"name":"delete_file","arguments":{}}</tool_call>',
        parserContext()), error => error?.code === AGENT_ERROR_CODES.UNKNOWN_TOOL);
});

test('Qwen3-Coder parser supports parameter-tag form without guessing names', () => {
    const result = parseToolOutput('qwen3_coder',
        '<tool_call>\n<function=read_file>\n<parameter=path>package.json</parameter>\n</function>\n</tool_call>',
        parserContext());
    assert.deepEqual(result.items[0].arguments, { path: 'package.json' });
});

test('Gemini and Anthropic parsers normalize provider-specific fields to arguments', () => {
    const gemini = parseToolOutput('gemini_synthetic',
        '<gemini_function_call nonce="nonce_test">{"name":"read_file","args":{"path":"package.json"}}</gemini_function_call>',
        parserContext());
    assert.deepEqual(gemini.items[0].arguments, { path: 'package.json' });

    const anthropic = parseToolOutput('anthropic_synthetic',
        '<tool_use nonce="nonce_test">{"id":"call_a","name":"read_file","input":{"path":"package.json"}}</tool_use>',
        parserContext());
    assert.equal(anthropic.items[0].callId, 'call_a');
});

test('parser registry exposes independent provider parsers', () => {
    const parserIds = listToolParsers();
    for (const required of ['openai_style_synthetic', 'qwen_hermes', 'qwen3_coder', 'gemini_synthetic', 'anthropic_synthetic', 'zenmux_native']) {
        assert.ok(parserIds.includes(required), required);
    }
});
