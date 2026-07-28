import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'node/index': 'src/node/index.ts',
    'node/cli': 'src/node/cli.ts',
  },
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  target: 'es2022',
  // Optional peer dependency: only the ./node entry touches it, and browser
  // consumers must never end up bundling a DOM implementation.
  external: ['linkedom'],
})
