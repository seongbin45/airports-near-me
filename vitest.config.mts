import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname),
      'server-only': path.resolve(import.meta.dirname, 'lib/__tests__/fixtures/server-only.ts'),
    },
  },
  test: { include: ["lib/**/*.test.ts"] },
});
