import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    server: 'src/server.ts',
  },
  format: ['esm'],
  // See packages/pagedate/tsup.config.ts: declarations come from tsc.
  dts: false,
  clean: true,
  sourcemap: true,
  target: 'es2022',
  // Real dependencies, resolved at runtime rather than inlined: bundling the
  // protocol SDK into a published package would pin a copy of it that no
  // consumer could dedupe or patch.
  external: ['@modelcontextprotocol/sdk', 'pagedate', 'zod', 'linkedom', 'node-html-parser'],
})
