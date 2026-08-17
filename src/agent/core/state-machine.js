import { AgentError, AGENT_ERROR_CODES } from './errors.js';
import { validateToolArguments, validateToolResultSize } from './validation.js';

export function analyzeConversation(items, tools) {
    const toolMap = new Map((tools || []).map(tool => [tool.name, tool]));
    const calls = new Map();
    const completedCallIds = new Set();

    for (const item of items || []) {
        if (item.type === 'tool_call') {
            if (!item.callId || typeof item.callId !== 'string') {
                throw new AgentError(
                    AGENT_ERROR_CODES.INVALID_REQUEST,
                    'Every tool call must contain a callId'
                );
            }
            if (calls.has(item.callId)) {
                throw new AgentError(
                    AGENT_ERROR_CODES.DUPLICATE_CALL_ID,
                    `Duplicate tool call ID: ${item.callId}`
                );
            }
            const tool = toolMap.get(item.name);
            if (!tool) {
                throw new AgentError(
                    AGENT_ERROR_CODES.UNKNOWN_TOOL,
                    `Tool call references undeclared tool: ${item.name}`
                );
            }
            item.arguments = validateToolArguments(tool, item.arguments);
            calls.set(item.callId, item);
            continue;
        }

        if (item.type === 'tool_result') {
            const call = calls.get(item.callId);
            if (!call) {
                throw new AgentError(
                    AGENT_ERROR_CODES.ORPHAN_TOOL_RESULT,
                    `Tool result references unknown call ID: ${item.callId}`
                );
            }
            if (completedCallIds.has(item.callId)) {
                throw new AgentError(
                    AGENT_ERROR_CODES.DUPLICATE_TOOL_RESULT,
                    `Tool call ${item.callId} already has a result`
                );
            }
            if (item.name && item.name !== call.name) {
                throw new AgentError(
                    AGENT_ERROR_CODES.INVALID_REQUEST,
                    `Tool result name ${item.name} does not match call ${call.name}`
                );
            }
            validateToolResultSize(item.output);
            completedCallIds.add(item.callId);
        }
    }

    const pendingCalls = [];
    for (const [callId, call] of calls) {
        if (!completedCallIds.has(callId)) pendingCalls.push(call);
    }

    return { calls, completedCallIds, pendingCalls, toolMap };
}

export function validateAssistantTurn(agentRequest, assistantTurn) {
    const history = analyzeConversation(agentRequest.items, agentRequest.tools);
    const toolCalls = (assistantTurn.items || []).filter(item => item.type === 'tool_call');
    const messages = (assistantTurn.items || []).filter(item => item.type === 'message');

    if (toolCalls.length === 0) {
        if (agentRequest.toolChoice.mode === 'required' || agentRequest.toolChoice.mode === 'function') {
            throw new AgentError(
                AGENT_ERROR_CODES.TOOL_CALL_REQUIRED,
                'The selected tool_choice requires a tool call, but the model returned a final message'
            );
        }
        if (messages.length === 0) {
            throw new AgentError(
                AGENT_ERROR_CODES.PROVIDER_PARSE_FAILED,
                'The model returned neither a final message nor a tool call'
            );
        }
        return assistantTurn;
    }

    if (agentRequest.toolChoice.mode === 'none') {
        throw new AgentError(
            AGENT_ERROR_CODES.TOOL_CALL_FORBIDDEN,
            'The model returned a tool call while tool_choice is none'
        );
    }
    if (!agentRequest.parallelToolCalls && toolCalls.length > 1) {
        throw new AgentError(
            AGENT_ERROR_CODES.PARALLEL_TOOL_CALLS_UNSUPPORTED,
            'The model returned multiple tool calls while parallel_tool_calls is disabled'
        );
    }

    const seen = new Set(history.calls.keys());
    const toolMap = history.toolMap;
    for (const call of toolCalls) {
        if (seen.has(call.callId)) {
            throw new AgentError(
                AGENT_ERROR_CODES.DUPLICATE_CALL_ID,
                `Duplicate tool call ID: ${call.callId}`
            );
        }
        seen.add(call.callId);
        const tool = toolMap.get(call.name);
        if (!tool) {
            throw new AgentError(
                AGENT_ERROR_CODES.UNKNOWN_TOOL,
                `Model requested undeclared tool: ${call.name}`
            );
        }
        if (agentRequest.toolChoice.mode === 'function' && call.name !== agentRequest.toolChoice.name) {
            throw new AgentError(
                AGENT_ERROR_CODES.TOOL_CHOICE_MISMATCH,
                `Model requested ${call.name}, but tool_choice requires ${agentRequest.toolChoice.name}`
            );
        }
        call.arguments = validateToolArguments(tool, call.arguments);
    }

    return assistantTurn;
}

export function assertConversationReadyForModel(agentRequest) {
    const analysis = analyzeConversation(agentRequest.items, agentRequest.tools);
    if (analysis.pendingCalls.length > 0) {
        throw new AgentError(
            AGENT_ERROR_CODES.INCOMPLETE_TOOL_RESULTS,
            `Missing tool results for call IDs: ${analysis.pendingCalls.map(call => call.callId).join(', ')}`
        );
    }
    return analysis;
}
