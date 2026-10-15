import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@chronoscope/contracts': resolve(__dirname, './packages/contracts/src'),
      '@chronoscope/domain': resolve(__dirname, './packages/domain/src'),
      '@chronoscope/events': resolve(__dirname, './packages/events/src'),
      '@chronoscope/database': resolve(__dirname, './packages/database/src'),
      '@chronoscope/read-store': resolve(__dirname, './packages/read-store/src'),
      '@chronoscope/messaging': resolve(__dirname, './packages/messaging/src'),
      '@chronoscope/projection-worker': resolve(__dirname, './apps/projection-worker/src'),
      '@chronoscope/replay-engine': resolve(__dirname, './packages/replay-engine/src'),
      '@chronoscope/chaos': resolve(__dirname, './packages/chaos/src'),
      '@chronoscope/chaos-agent': resolve(__dirname, './apps/chaos-agent/src'),
      '@chronoscope/observability': resolve(__dirname, './packages/observability/src'),
      '@chronoscope/testing': resolve(__dirname, './packages/testing/src'),
    },
  },
  test: {
    include: ['apps/*/src/**/*.test.ts', 'packages/*/src/**/*.test.ts', 'tests/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    testTimeout: 20_000,
    passWithNoTests: true,
  },
});
