import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['**/*.test.ts', '**/*.spec.ts'],
    exclude: ['**/node_modules/**', 'node_modules', 'dist', '**/admin-ui/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules', 'dist', '**/*.test.ts', '**/*.spec.ts'],
    },
    testTimeout: 30000,
  },
  resolve: {
    alias: {
      '@retailfixit/shared': path.resolve(__dirname, './src/backend/shared/src'),
    },
  },
});
