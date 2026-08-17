import { contentPartsToText } from '../../ir/content-parts.js';
import { createOutputItemId } from '../../ir/ids.js';

function outputItemsFromTurn(assistantTurn) {
    const output = [];
    for (const item of assistantTurn.items || []) {
        if (item.type === 'tool_call') {
            if (!item.id) item.id = createOutputItemId('fc');
            output.push({
                type: 'function_call',
                id: item.id,
                status: 'completed',
                call_id: item.callId,
                name: item.name,
                arguments: JSON.stringify(item.arguments)
            });
        } else if (item.type === 'message') {
            if (!item.id) item.id = createOutputItemId('msg');
            output.push({
                type: 'message',
                id: item.id,
                status: 'completed',
                role: 'assistant',
                content: [{
                    type: 'output_text',
                    text: contentPartsToText(item.content),
                    annotations: []
                }]
            });
        } else if (item.type === 'reasoning') {
            if (!item.id) item.id = createOutputItemId('rs');
            output.push({
                type: 'reasoning',
                id: item.id,
                status: 'completed',
                summary: item.summary ? [{ type: 'summary_text', text: item.summary }] : []
            });
        }
    }
    return output;
}

function responseUsage() {
    return {
        input_tokens: 0,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens: 0,
        output_tokens_details: { reasoning_tokens: 0 },
        total_tokens: 0
    };
}

export function buildOpenAIResponsesObject(agentRequest, assistantTurn, responseId, options = {}) {
    const now = options.now || Date.now();
    const output = outputItemsFromTurn(assistantTurn);
    const outputText = output
        .filter(item => item.type === 'message')
        .flatMap(item => item.content || [])
        .filter(part => part.type === 'output_text')
        .map(part => part.text)
        .join('');

    return {
        id: responseId,
        object: 'response',
        created_at: Math.floor(now / 1000),
        status: 'completed',
        error: null,
        incomplete_details: null,
        instructions: agentRequest.instructions.length > 0 ? agentRequest.instructions.map(item => (
            item.content.map(part => part.text || '').join('')
        )).join('\n') : null,
        max_output_tokens: null,
        model: agentRequest.model,
        output,
        output_text: outputText,
        parallel_tool_calls: agentRequest.parallelToolCalls,
        previous_response_id: agentRequest.metadata?.previousResponseId || null,
        reasoning: { effort: null, summary: null },
        store: true,
        temperature: 1,
        tool_choice: agentRequest.toolChoice.mode === 'function'
            ? { type: 'function', name: agentRequest.toolChoice.name }
            : agentRequest.toolChoice.mode,
        tools: agentRequest.tools.map(tool => ({
            type: 'function',
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
            strict: tool.strict
        })),
        top_p: 1,
        truncation: 'disabled',
        usage: responseUsage()
    };
}

function event(type, payload, sequenceNumber) {
    return {
        type,
        sequence_number: sequenceNumber,
        ...payload
    };
}

export function buildOpenAIResponsesEvents(response, assistantTurn) {
    const events = [];
    let sequenceNumber = 0;
    const inProgress = { ...response, status: 'in_progress', output: [], output_text: '' };
    events.push(event('response.created', { response: inProgress }, sequenceNumber++));
    events.push(event('response.in_progress', { response: inProgress }, sequenceNumber++));

    for (let outputIndex = 0; outputIndex < response.output.length; outputIndex++) {
        const item = response.output[outputIndex];
        const addedItem = item.type === 'function_call'
            ? { ...item, status: 'in_progress', arguments: '' }
            : { ...item, status: 'in_progress' };
        events.push(event('response.output_item.added', {
            response_id: response.id,
            output_index: outputIndex,
            item: addedItem
        }, sequenceNumber++));

        if (item.type === 'function_call') {
            events.push(event('response.function_call_arguments.delta', {
                response_id: response.id,
                item_id: item.id,
                output_index: outputIndex,
                delta: item.arguments
            }, sequenceNumber++));
            events.push(event('response.function_call_arguments.done', {
                response_id: response.id,
                item_id: item.id,
                output_index: outputIndex,
                call_id: item.call_id,
                name: item.name,
                arguments: item.arguments
            }, sequenceNumber++));
        } else if (item.type === 'message') {
            const text = item.content?.find(part => part.type === 'output_text')?.text || '';
            const part = { type: 'output_text', text: '', annotations: [] };
            events.push(event('response.content_part.added', {
                response_id: response.id,
                item_id: item.id,
                output_index: outputIndex,
                content_index: 0,
                part
            }, sequenceNumber++));
            if (text) {
                events.push(event('response.output_text.delta', {
                    response_id: response.id,
                    item_id: item.id,
                    output_index: outputIndex,
                    content_index: 0,
                    delta: text
                }, sequenceNumber++));
            }
            events.push(event('response.output_text.done', {
                response_id: response.id,
                item_id: item.id,
                output_index: outputIndex,
                content_index: 0,
                text
            }, sequenceNumber++));
            events.push(event('response.content_part.done', {
                response_id: response.id,
                item_id: item.id,
                output_index: outputIndex,
                content_index: 0,
                part: { ...part, text }
            }, sequenceNumber++));
        }

        events.push(event('response.output_item.done', {
            response_id: response.id,
            output_index: outputIndex,
            item
        }, sequenceNumber++));
    }

    events.push(event('response.completed', { response }, sequenceNumber));
    return events;
}
