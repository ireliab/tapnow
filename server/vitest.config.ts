import os from 'node:os'
import path from 'node:path'
import { defineConfig } from 'vitest/config'

// every test run gets a throwaway data dir so real projects/settings are never touched
export default defineConfig({
  test: {
    env: { TAPLOCAL_DATA: path.join(os.tmpdir(), `taplocal-test-${process.pid}-${Date.now()}`) },
    fileParallelism: false,
  },
})
