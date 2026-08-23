import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        testTimeout: 15_000,
        include: [
            'src/Ballistics.Desktop/src/ui/**/*.test.ts',
            'src/Ballistics.Desktop/electron/**/*.test.ts',
            'scripts/release/**/*.test.mjs',
            'scripts/build/**/*.test.mjs',
            'scripts/e2e/**/*.test.mjs',
            'scripts/fuzz/**/*.test.mjs',
            'scripts/performance/**/*.test.mjs',
            'scripts/product/**/*.test.mjs',
            'scripts/protocol/**/*.test.mjs',
            'scripts/batch/**/*.test.mjs',
            'validation/**/*.test.mjs',
        ],
    },
});
