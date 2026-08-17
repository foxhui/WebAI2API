import Ajv from 'ajv';

import { AgentError, AGENT_ERROR_CODES } from './errors.js';

export const DEFAULT_SECURITY_LIMITS = Object.freeze({
    maxTools: 128,
    maxToolNameLength: 64,
    maxDescriptionBytes: 16 * 1024,
    maxSchemaBytes: 256 * 1024,
    maxArgumentsBytes: 512 * 1024,
    maxToolResultBytes: 2 * 1024 * 1024,
    maxObjectDepth: 24,
    maxObjectKeys: 4096,
    maxArrayLength: 4096,
    maxStringBytes: 2 * 1024 * 1024
});

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const TOOL_NAME_PATTERN = /^[A-Za-z0-9_-]+$/;

// Codex and other Responses API clients advertise provider-side tools together
// with their function tools. WebAI2API cannot execute provider-side tools, but
// it can expose ordinary functions. Namespace entries are expanded below so
// Codex's real shell/file tools are not lost; the remaining provider-side
// types are ignored. Keep this list explicit so arbitrary malformed tool types
// still fail validation instead of being silently accepted.
export const IGNORABLE_OPENAI_BUILTIN_TOOL_TYPES = Object.freeze([
    'code_interpreter',
    'computer_use',
    'computer_use_preview',
    'file_search',
    'image_generation',
    'local_shell',
    'mcp',
    'namespace',
    'shell',
    'web_search',
    'web_search_preview'
]);

const OPENAI_BUILTIN_TOOL_TYPES = new Set(IGNORABLE_OPENAI_BUILTIN_TOOL_TYPES);
const ajv = new Ajv({
    allErrors: true,
    strict: false,
    allowUnionTypes: true,
    ownProperties: true,
    coerceTypes: false,
    useDefaults: false,
    removeAdditional: false
});
const compiledSchemas = new WeakMap();

function byteLength(value) {
    return Buffer.byteLength(value, 'utf8');
}

function jsonByteLength(value, code, label) {
    let serialized;
    try {
        serialized = JSON.stringify(value);
    } catch (error) {
        throw new AgentError(code, `${label} must be JSON serializable`);
    }
    return byteLength(serialized);
}

export function inspectUntrustedValue(value, options = {}) {
    const limits = { ...DEFAULT_SECURITY_LIMITS, ...(options.limits || options) };
    const rootLabel = options.label || 'value';
    const seen = new WeakSet();

    function visit(current, depth, path) {
        if (depth > limits.maxObjectDepth) {
            throw new AgentError(
                AGENT_ERROR_CODES.STATE_LIMIT,
                `${rootLabel} exceeds the maximum object depth at ${path}`
            );
        }
        if (typeof current === 'string' && byteLength(current) > limits.maxStringBytes) {
            throw new AgentError(
                AGENT_ERROR_CODES.STATE_LIMIT,
                `${rootLabel} contains an oversized string at ${path}`
            );
        }
        if (!current || typeof current !== 'object') return;
        if (seen.has(current)) {
            throw new AgentError(
                AGENT_ERROR_CODES.INVALID_REQUEST,
                `${rootLabel} contains a circular reference at ${path}`
            );
        }
        seen.add(current);

        if (Array.isArray(current)) {
            if (current.length > limits.maxArrayLength) {
                throw new AgentError(
                    AGENT_ERROR_CODES.STATE_LIMIT,
                    `${rootLabel} exceeds the maximum array length at ${path}`
                );
            }
            current.forEach((item, index) => visit(item, depth + 1, `${path}[${index}]`));
            seen.delete(current);
            return;
        }

        const keys = Object.keys(current);
        if (keys.length > limits.maxObjectKeys) {
            throw new AgentError(
                AGENT_ERROR_CODES.STATE_LIMIT,
                `${rootLabel} exceeds the maximum object key count at ${path}`
            );
        }
        for (const key of keys) {
            if (FORBIDDEN_KEYS.has(key)) {
                throw new AgentError(
                    AGENT_ERROR_CODES.INVALID_REQUEST,
                    `${rootLabel} contains forbidden object key "${key}"`
                );
            }
            visit(current[key], depth + 1, `${path}.${key}`);
        }
        seen.delete(current);
    }

    visit(value, 0, '$');
    return value;
}

function normalizeToolDefinition(rawTool, index, limits) {
    if (!rawTool || typeof rawTool !== 'object' || rawTool.type !== 'function') {
        const type = rawTool?.type || 'unknown';
        const code = type === 'function'
            ? AGENT_ERROR_CODES.INVALID_TOOL_DEFINITION
            : AGENT_ERROR_CODES.UNSUPPORTED_BUILTIN_TOOL;
        throw new AgentError(code, `Unsupported tool type at tools[${index}]: ${type}`);
    }

    const source = rawTool.function && typeof rawTool.function === 'object'
        ? rawTool.function
        : rawTool;
    const name = source.name;
    if (
        typeof name !== 'string' ||
        name.length === 0 ||
        name.length > limits.maxToolNameLength ||
        !TOOL_NAME_PATTERN.test(name)
    ) {
        throw new AgentError(
            AGENT_ERROR_CODES.INVALID_TOOL_DEFINITION,
            `Invalid function name at tools[${index}]`
        );
    }

    const description = source.description ?? '';
    if (typeof description !== 'string' || byteLength(description) > limits.maxDescriptionBytes) {
        throw new AgentError(
            AGENT_ERROR_CODES.INVALID_TOOL_DEFINITION,
            `Invalid or oversized description for tool ${name}`
        );
    }

    const parameters = source.parameters ?? {
        type: 'object',
        properties: {},
        additionalProperties: false
    };
    if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) {
        throw new AgentError(
            AGENT_ERROR_CODES.INVALID_TOOL_SCHEMA,
            `Tool ${name} parameters must be a JSON Schema object`
        );
    }
    inspectUntrustedValue(parameters, { limits, label: `schema for tool ${name}` });
    if (jsonByteLength(parameters, AGENT_ERROR_CODES.INVALID_TOOL_SCHEMA, `Schema for tool ${name}`) > limits.maxSchemaBytes) {
        throw new AgentError(
            AGENT_ERROR_CODES.INVALID_TOOL_SCHEMA,
            `Schema for tool ${name} exceeds the size limit`
        );
    }
    if (!ajv.validateSchema(parameters)) {
        throw new AgentError(
            AGENT_ERROR_CODES.INVALID_TOOL_SCHEMA,
            `Tool ${name} contains an invalid JSON Schema`,
            { details: ajv.errors?.map(error => `${error.instancePath || '/'} ${error.message}`) }
        );
    }
    try {
        ajv.compile(parameters);
    } catch (error) {
        throw new AgentError(
            AGENT_ERROR_CODES.INVALID_TOOL_SCHEMA,
            `Tool ${name} schema could not be compiled: ${error.message}`
        );
    }

    return {
        type: 'function',
        name,
        description,
        parameters: structuredClone(parameters),
        strict: source.strict === true
    };
}

export function normalizeToolDefinitions(rawTools, options = {}) {
    const limits = { ...DEFAULT_SECURITY_LIMITS, ...(options.limits || {}) };
    if (rawTools === undefined || rawTools === null) return [];
    if (!Array.isArray(rawTools)) {
        throw new AgentError(AGENT_ERROR_CODES.INVALID_TOOL_DEFINITION, 'tools must be an array');
    }
    if (rawTools.length > limits.maxTools) {
        throw new AgentError(
            AGENT_ERROR_CODES.STATE_LIMIT,
            `tools exceeds the maximum count of ${limits.maxTools}`
        );
    }

    const names = new Set();
    const ignoredBuiltinTypes = options.ignoreUnsupportedBuiltinTools === true
        ? new Set([
            ...OPENAI_BUILTIN_TOOL_TYPES,
            ...(options.ignoredToolTypes || [])
        ])
        : null;
    const normalizedTools = [];

    const appendNormalizedTool = normalized => {
        if (normalizedTools.length >= limits.maxTools) {
            throw new AgentError(
                AGENT_ERROR_CODES.STATE_LIMIT,
                `tools exceeds the maximum count of ${limits.maxTools}`
            );
        }
        if (names.has(normalized.name)) {
            throw new AgentError(
                AGENT_ERROR_CODES.INVALID_TOOL_DEFINITION,
                `Duplicate tool definition: ${normalized.name}`
            );
        }
        names.add(normalized.name);
        normalizedTools.push(normalized);
    };

    rawTools.forEach((tool, index) => {
        if (ignoredBuiltinTypes && tool?.type === 'namespace') {
            // Responses namespace wrappers contain function definitions. The
            // synthetic compatibility layer only understands flat functions,
            // so expand the children while preserving their original names.
            if (!Array.isArray(tool.tools)) return;
            tool.tools.forEach((nestedTool, nestedIndex) => {
                if (ignoredBuiltinTypes.has(nestedTool?.type)) return;
                appendNormalizedTool(
                    normalizeToolDefinition(nestedTool, `${index}.tools[${nestedIndex}]`, limits)
                );
            });
            return;
        }
        if (ignoredBuiltinTypes?.has(tool?.type)) return;
        appendNormalizedTool(normalizeToolDefinition(tool, index, limits));
    });

    return normalizedTools;
}

export function parseToolArguments(rawArguments, options = {}) {
    const limits = { ...DEFAULT_SECURITY_LIMITS, ...(options.limits || {}) };
    const label = options.label || 'Tool arguments';
    if (typeof rawArguments !== 'string') {
        throw new AgentError(
            AGENT_ERROR_CODES.INVALID_TOOL_ARGUMENTS,
            `${label} must be a JSON string`
        );
    }
    if (byteLength(rawArguments) > limits.maxArgumentsBytes) {
        throw new AgentError(
            AGENT_ERROR_CODES.STATE_LIMIT,
            `${label} exceeds the size limit`
        );
    }

    let parsed;
    try {
        parsed = JSON.parse(rawArguments);
    } catch (error) {
        throw new AgentError(
            AGENT_ERROR_CODES.INVALID_TOOL_ARGUMENTS,
            `${label} is not valid JSON: ${error.message}`
        );
    }
    return normalizeArgumentsObject(parsed, { limits, label });
}

export function normalizeArgumentsObject(value, options = {}) {
    const limits = { ...DEFAULT_SECURITY_LIMITS, ...(options.limits || {}) };
    const label = options.label || 'Tool arguments';
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new AgentError(
            AGENT_ERROR_CODES.INVALID_TOOL_ARGUMENTS,
            `${label} must decode to a JSON object`
        );
    }
    inspectUntrustedValue(value, { limits, label });
    if (jsonByteLength(value, AGENT_ERROR_CODES.INVALID_TOOL_ARGUMENTS, label) > limits.maxArgumentsBytes) {
        throw new AgentError(AGENT_ERROR_CODES.STATE_LIMIT, `${label} exceeds the size limit`);
    }
    return structuredClone(value);
}

export function validateToolArguments(tool, argumentsObject) {
    if (!tool) {
        throw new AgentError(AGENT_ERROR_CODES.UNKNOWN_TOOL, 'Tool is not declared');
    }
    const args = normalizeArgumentsObject(argumentsObject, { label: `Arguments for ${tool.name}` });
    let validate = compiledSchemas.get(tool.parameters);
    if (!validate) {
        try {
            validate = ajv.compile(tool.parameters);
        } catch (error) {
            throw new AgentError(
                AGENT_ERROR_CODES.INVALID_TOOL_SCHEMA,
                `Tool ${tool.name} schema could not be compiled: ${error.message}`
            );
        }
        compiledSchemas.set(tool.parameters, validate);
    }
    if (!validate(args)) {
        const details = validate.errors?.map(error => `${error.instancePath || '/'} ${error.message}`) || [];
        throw new AgentError(
            AGENT_ERROR_CODES.INVALID_TOOL_ARGUMENTS,
            `Arguments for tool ${tool.name} do not match its JSON Schema`,
            { details }
        );
    }
    return args;
}

export function validateToolResultSize(parts, options = {}) {
    const limits = { ...DEFAULT_SECURITY_LIMITS, ...(options.limits || {}) };
    inspectUntrustedValue(parts, { limits, label: 'Tool result' });
    if (jsonByteLength(parts, AGENT_ERROR_CODES.STATE_LIMIT, 'Tool result') > limits.maxToolResultBytes) {
        throw new AgentError(AGENT_ERROR_CODES.STATE_LIMIT, 'Tool result exceeds the size limit');
    }
    return parts;
}
