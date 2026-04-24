import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './e2e',
    timeout: 120_000,
    retries: 0,
    workers: 1,
    use: {
        headless: false,
        viewport: { width: 1280, height: 800 },
        storageState: './data/deepseek-auth.json',
        trace: 'on-first-retry',
    },
    projects: [
        {
            name: 'chromium',
            use: { browserName: 'chromium' },
            testMatch: 'deepseek.test.js',
        },
        {
            name: 'api',
            testMatch: 'api.test.js',
        },
    ],
});
