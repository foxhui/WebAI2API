import assert from 'node:assert/strict';
import test from 'node:test';

import {
    AGENT_ERROR_CODES,
    ConversationStore,
    analyzeConversation,
    normalizeToolDefinitions,
    parseToolArguments,
    validateAssistantTurn,
    validateToolArguments
} from '../src/agent/index.js';

function sampleTools() {
    return normalizeToolDefinitions([{
        type: 'function',
        function: {
            name: 'read_file',
            description: 'Read one file',
            strict: true,
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', minLength: 1 }
                },
                required: ['path'],
                additionalProperties: false
            }
        }
    }]);
}

function expectAgentCode(fn, code) {
    assert.throws(fn, error => error?.code === code);
}

test('tool definitions normalize Chat and Responses function shapes', () => {
    const [chatTool] = sampleTools();
    const [responsesTool] = normalizeToolDefinitions([{
        type: 'function',
        name: 'write_file',
        description: 'Write one file',
        parameters: {
            type: 'object',
            properties: { path: { type: 'string' }, text: { type: 'string' } },
            required: ['path', 'text'],
            additionalProperties: false
        }
    }]);

    assert.equal(chatTool.name, 'read_file');
    assert.equal(chatTool.strict, true);
    assert.equal(responsesTool.name, 'write_file');
});

test('Codex Responses built-in tools are ignored while unknown types remain invalid', () => {
    const tools = normalizeToolDefinitions([
        { type: 'web_search_preview' },
        sampleTools()[0],
        { type: 'computer_use_preview' },
        {
            type: 'namespace',
            name: 'container',
            tools: [{
                type: 'function',
                name: 'shell_command',
                description: 'Run a bounded command',
                parameters: {
                    type: 'object',
                    properties: { command: { type: 'string' } },
                    required: ['command'],
                    additionalProperties: false
                }
            }]
        }
    ], { ignoreUnsupportedBuiltinTools: true });

    assert.deepEqual(tools.map(tool => tool.name), ['read_file', 'shell_command']);
    expectAgentCode(
        () => normalizeToolDefinitions([{ type: 'vendor_specific_tool' }], {
            ignoreUnsupportedBuiltinTools: true
        }),
        AGENT_ERROR_CODES.UNSUPPORTED_BUILTIN_TOOL
    );
});

test('tool argument validation is strict and does not coerce values', () => {
    const [tool] = sampleTools();

    assert.deepEqual(validateToolArguments(tool, { path: 'package.json' }), { path: 'package.json' });
    expectAgentCode(
        () => validateToolArguments(tool, { path: 42 }),
        AGENT_ERROR_CODES.INVALID_TOOL_ARGUMENTS
    );
    expectAgentCode(
        () => validateToolArguments(tool, { path: 'package.json', unexpected: true }),
        AGENT_ERROR_CODES.INVALID_TOOL_ARGUMENTS
    );
});

test('tool argument parser rejects arrays and object-pollution keys', () => {
    expectAgentCode(
        () => parseToolArguments('["package.json"]'),
        AGENT_ERROR_CODES.INVALID_TOOL_ARGUMENTS
    );
    expectAgentCode(
        () => parseToolArguments('{"__proto__":{"polluted":true}}'),
        AGENT_ERROR_CODES.INVALID_REQUEST
    );
    assert.equal(Object.prototype.polluted, undefined);
});

test('conversation state links each result to one declared pending call', () => {
    const tools = sampleTools();
    const analysis = analyzeConversation([
        {
            type: 'tool_call',
            callId: 'call_1',
            name: 'read_file',
            arguments: { path: 'package.json' }
        },
        {
            type: 'tool_result',
            callId: 'call_1',
            name: 'read_file',
            output: [{ type: 'text', text: '{"ok":true}' }],
            isError: false
        }
    ], tools);

    assert.equal(analysis.calls.size, 1);
    assert.equal(analysis.completedCallIds.has('call_1'), true);
    assert.deepEqual(analysis.pendingCalls, []);

    expectAgentCode(() => analyzeConversation([{
        type: 'tool_result',
        callId: 'missing',
        output: [{ type: 'text', text: 'nope' }],
        isError: true
    }], tools), AGENT_ERROR_CODES.ORPHAN_TOOL_RESULT);
});

test('assistant turn enforces tool choice, call ID uniqueness, and parallel policy', () => {
    const baseRequest = {
        items: [],
        tools: sampleTools(),
        toolChoice: { mode: 'none' },
        parallelToolCalls: false
    };
    const call = {
        type: 'tool_call',
        callId: 'call_new',
        name: 'read_file',
        arguments: { path: 'package.json' }
    };

    expectAgentCode(
        () => validateAssistantTurn(baseRequest, { items: [call] }),
        AGENT_ERROR_CODES.TOOL_CALL_FORBIDDEN
    );

    expectAgentCode(
        () => validateAssistantTurn({
            ...baseRequest,
            toolChoice: { mode: 'auto' }
        }, { items: [call, { ...call, callId: 'call_second' }] }),
        AGENT_ERROR_CODES.PARALLEL_TOOL_CALLS_UNSUPPORTED
    );
});

test('conversation store expires and bounds response state', () => {
    let now = 1000;
    const store = new ConversationStore({ ttlMs: 50, maxEntries: 2, now: () => now });
    store.save('resp_1', { model: 'one' });
    store.save('resp_2', { model: 'two' });
    store.save('resp_3', { model: 'three' });

    expectAgentCode(() => store.get('resp_1'), AGENT_ERROR_CODES.RESPONSE_NOT_FOUND);
    assert.deepEqual(store.get('resp_3'), { model: 'three' });

    now += 51;
    expectAgentCode(() => store.get('resp_3'), AGENT_ERROR_CODES.RESPONSE_EXPIRED);
    assert.equal(store.size, 0);
});
