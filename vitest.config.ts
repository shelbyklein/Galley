import { defineConfig } from 'vitest/config';

// Root runner: `npm test` runs every workspace's own vitest.config.ts as a project.
// Each workspace also runs standalone: `npm test -w @galley/model`.
export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/*'],
  },
});
