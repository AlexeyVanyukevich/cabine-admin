import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/ui',
  testMatch: '**/*.spec.ts',
  globalSetup: './tests/ui/global-setup.ts',
  // One engine, one database, one server: the specs share them and must not race each other.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 30_000,
  reporter: [['list']],
  use: { trace: 'on-first-retry' },
  projects: [
    {
      name: 'chromium',
      // The tool is opened from a phone more often than from a desk, so that is the shape the
      // journeys run at. The viewport comes after the device spread, which sets its own.
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } },
    },
  ],
})
