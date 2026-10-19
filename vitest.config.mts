import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

// The database driver is built on Node-API since 13.0.0, so a plain Node test runner loads it
// and the repositories can be tested against a real in-memory database with every migration
// applied. Anything that imports Electron still has to be mocked.
export default defineConfig({
  resolve: {
    alias: {
      '@renderer': resolve('src/renderer/src'),
      '@shared': resolve('src/shared')
    }
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'packages/*/src/**/*.test.ts', 'apps/mobile/src/**/*.test.ts']
  }
})
