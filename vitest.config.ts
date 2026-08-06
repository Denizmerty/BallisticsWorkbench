import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/Ballistics.Desktop/src/ui/**/*.test.ts'],
  },
});
