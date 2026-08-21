import { realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// pnpm installs @testing-library/react's peer React beside the package's real
// path under .pnpm, not beside the root symlink, so resolution has to start
// from the realpath to find one React copy for the aliases below.
const testingLibrary = realpathSync(resolve(import.meta.dirname, '../../../node_modules/@testing-library/react'))
const testingLibraryRequire = createRequire(resolve(testingLibrary, 'package.json'))

export default defineConfig({
  root: import.meta.dirname,
  resolve: {
    alias: [
      { find: '@testing-library/react', replacement: testingLibrary },
      { find: 'react/jsx-dev-runtime', replacement: testingLibraryRequire.resolve('react/jsx-dev-runtime') },
      { find: 'react/jsx-runtime', replacement: testingLibraryRequire.resolve('react/jsx-runtime') },
      { find: 'react', replacement: testingLibraryRequire.resolve('react') },
      { find: 'react-dom', replacement: testingLibraryRequire.resolve('react-dom') },
      // The bridge packages are not workspace members, so the shared baseline
      // import resolves to source instead of a node_modules symlink.
      { find: '@deepseek-ai/dsh-client-ui-primitives', replacement: resolve(import.meta.dirname, '../../../packages/client/ui-primitives/src/index.ts') },
    ],
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.spec.ts'],
  },
})
