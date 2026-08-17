import { AgentError, AGENT_ERROR_CODES } from './errors.js';

export class ConversationStore {
    constructor(options = {}) {
        this.ttlMs = options.ttlMs || 15 * 60 * 1000;
        this.maxEntries = options.maxEntries || 500;
        this.now = options.now || Date.now;
        this.entries = new Map();
    }

    save(responseId, state) {
        if (!responseId || typeof responseId !== 'string') {
            throw new AgentError(AGENT_ERROR_CODES.INVALID_REQUEST, 'responseId is required');
        }
        this.prune();
        if (!this.entries.has(responseId) && this.entries.size >= this.maxEntries) {
            const oldestKey = this.entries.keys().next().value;
            this.entries.delete(oldestKey);
        }
        this.entries.set(responseId, {
            expiresAt: this.now() + this.ttlMs,
            state: structuredClone(state)
        });
    }

    get(responseId) {
        const entry = this.entries.get(responseId);
        if (!entry) {
            throw new AgentError(
                AGENT_ERROR_CODES.RESPONSE_NOT_FOUND,
                `Unknown previous_response_id: ${responseId}`
            );
        }
        if (entry.expiresAt <= this.now()) {
            this.entries.delete(responseId);
            throw new AgentError(
                AGENT_ERROR_CODES.RESPONSE_EXPIRED,
                `previous_response_id has expired: ${responseId}`
            );
        }
        return structuredClone(entry.state);
    }

    delete(responseId) {
        return this.entries.delete(responseId);
    }

    prune() {
        const now = this.now();
        for (const [responseId, entry] of this.entries) {
            if (entry.expiresAt <= now) this.entries.delete(responseId);
        }
    }

    get size() {
        this.prune();
        return this.entries.size;
    }
}
