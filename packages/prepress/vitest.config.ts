import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'prepress',
    environment: 'node',
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
  },
});
