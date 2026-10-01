import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    name: 'desktop',
    // Default is node; a test that needs a DOM opts in with a `// @vitest-environment jsdom` docblock.
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}', 'test/**/*.test.{ts,tsx}'],
    // Playwright specs live in e2e/ and are named *.e2e.ts, so they never match the include globs above.
    exclude: ['e2e/**', 'out/**', 'node_modules/**'],
  },
});
