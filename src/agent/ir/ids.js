import crypto from 'node:crypto';

export function createAgentId(prefix) {
    const normalizedPrefix = String(prefix || 'agent').replace(/[^a-z0-9_]/gi, '_');
    return `${normalizedPrefix}_${crypto.randomUUID().replaceAll('-', '')}`;
}

export function createCallId() {
    return createAgentId('call');
}

export function createResponseId() {
    return createAgentId('resp');
}

export function createOutputItemId(prefix = 'msg') {
    return createAgentId(prefix);
}

export function createEnvelopeNonce() {
    return crypto.randomBytes(18).toString('base64url');
}
