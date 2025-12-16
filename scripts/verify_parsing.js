
import { parseRequest } from '../src/server/parseChat.js';

// Mock options
const mockOptions = {
    tempDir: './data/temp',
    imageLimit: 5,
    backendName: 'test-backend',
    resolveModelId: (id) => id === 'gpt-4-text' ? 'resolved-gpt-4' : null,
    getImagePolicy: () => 'optional',
    getModelType: (id) => id === 'gpt-4-text' ? 'text' : 'image',
    requestId: 'test-req-id',
    logger: { info: console.log, error: console.error, warn: console.warn, debug: console.log }
};

async function testTextParsing() {
    console.log('--- Testing Text Model Parsing ---');
    const requestData = {
        model: 'gpt-4-text',
        stream: true,
        messages: [
            { role: 'system', content: 'You are a cat.' },
            { role: 'user', content: 'Hello' },
            { role: 'assistant', content: 'Meow' },
            {
                role: 'user', content: [
                    { type: 'text', text: 'Look at this ' },
                    { type: 'image_url', image_url: { url: 'https://example.com/image.png' } }
                ]
            }
        ]
    };

    const result = await parseRequest(requestData, mockOptions);

    if (result.success) {
        console.log('Success!');
        console.log('Prompt:\n' + result.data.prompt);
        console.log('Image Paths:', result.data.imagePaths);

        if (result.data.prompt.includes('=== 系统指令') && result.data.prompt.includes('User: Look at this')) {
            console.log('✅ Text Parsing Verification PASSED');
        } else {
            console.error('❌ Text Parsing Verification FAILED');
        }

    } else {
        console.error('Failed:', result.error);
    }
}

async function testImageParsing() {
    console.log('\n--- Testing Image Model Parsing (Legacy) ---');
    const requestData = {
        model: 'some-image-model',
        stream: false,
        messages: [
            { role: 'user', content: 'Draw a cat' }
        ]
    };

    const options = {
        ...mockOptions,
        resolveModelId: (id) => 'resolved-image-model',
        getModelType: () => 'image'
    };

    const result = await parseRequest(requestData, options);

    if (result.success) {
        console.log('Success!');
        console.log('Prompt:', result.data.prompt);
        if (result.data.prompt === 'Draw a cat') {
            console.log('✅ Image Parsing Verification PASSED');
        } else {
            console.error('❌ Image Parsing Verification FAILED');
        }
    } else {
        console.error('Failed:', result.error);
    }
}

(async () => {
    try {
        await testTextParsing();
        await testImageParsing();
    } catch (e) {
        console.error(e);
    }
})();
