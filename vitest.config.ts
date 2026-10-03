import { defineConfig } from 'vitest/config';

// Separate from vite.config.ts so tests skip the PWA plugin; PBKDF2 at 600k rounds needs a long timeout.
export default defineConfig({
  test: { environment: 'node', include: ['src/**/*.test.ts'], testTimeout: 30_000 },
});
