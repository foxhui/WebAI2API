export const nativePassThroughStrategy = {
    id: 'native_pass_through',
    parserId: 'zenmux_native',
    kind: 'native',
    render(request) {
        return {
            prompt: null,
            nativeRequest: {
                tools: request.tools,
                toolChoice: request.toolChoice,
                parallelToolCalls: request.parallelToolCalls
            },
            nonce: null,
            strategyId: this.id,
            parserId: this.parserId,
            providerOpaqueState: null
        };
    }
};
