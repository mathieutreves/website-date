import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'edge/index': 'src/edge/index.ts',
    'node/index': 'src/node/index.ts',
    'node/cli': 'src/node/cli.ts',
  },
  format: ['esm'],
  // Declarations come from `tsc --emitDeclarationOnly`, not from here. tsup
  // generates them through a bundled `rollup-plugin-dts`, which reaches into
  // the TypeScript compiler API and caps out at TS 6 — and it injects a
  // `baseUrl` that TS 6 itself deprecates, so the path is closed in both
  // directions. Emitting with the same compiler that typechecks is one fewer
  // thing that can disagree with `tsc`, at the cost of unbundled `.d.ts`.
  dts: false,
  clean: true,
  sourcemap: true,
  treeshake: true,
  target: 'es2022',
  // Optional peer dependency: only the ./node entry touches it, and browser
  // consumers must never end up bundling a DOM implementation.
  external: ['linkedom'],
})
