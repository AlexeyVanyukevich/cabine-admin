import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globalSetup: ['./tests/integration/global-setup.ts'],
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
    // The engine image is built once here; a cold build is slow.
    hookTimeout: 180_000,
    pool: 'forks',
    // One database, truncated between cases.
    fileParallelism: false,
  },
})
