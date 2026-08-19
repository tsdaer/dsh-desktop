import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

const testingLibrary = resolve(import.meta.dirname, '../../../node_modules/@testing-library/react')
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
    ],
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.spec.ts'],
  },
})
