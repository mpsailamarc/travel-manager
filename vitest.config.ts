import { defineConfig } from 'vitest/config'

// Tests run in Node with an in-memory IndexedDB (fake-indexeddb) and no network: every request to a free service fails,
// so the app's offline fallbacks (straight-line distances, estimates) are what gets tested, and results are repeatable.
export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['src/test/setup.ts'],
    include: ['src/**/*.test.ts'],
    testTimeout: 20000,
  },
})
