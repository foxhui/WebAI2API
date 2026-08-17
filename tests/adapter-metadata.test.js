import assert from 'node:assert/strict';
import test from 'node:test';

import { manifest as deepseekManifest } from '../src/backend/adapter/deepseek_text.js';

test('DeepSeek text models are exposed as text models', () => {
    assert.ok(deepseekManifest.models.length > 0);
    for (const model of deepseekManifest.models) {
        assert.equal(model.type, 'text', `${model.id} must be typed as text`);
    }
});
