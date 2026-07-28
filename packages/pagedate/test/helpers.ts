import { DOMParser } from 'linkedom'
import type { Env } from '../src/types.js'
import { parseHtml } from '../src/node/index.js'

/**
 * Build a `Document` from an HTML string.
 *
 * Deliberately the library's *own* `parseHtml`, not a parser chosen for the
 * tests. `pagedate/node` ships `node-html-parser`; parsing with linkedom here
 * instead would mean every test and every published figure describes a parser no
 * caller uses, and the two would be free to drift apart without a single test
 * going red. `bench/parity.mjs` checks that they have not.
 *
 * The returned object is structurally compatible with the subset of the DOM the
 * library uses but not nominally identical to lib.dom's, hence the cast inside
 * `parseHtml` — confined there rather than spread through the tests.
 *
 * The browser is a third case that nothing here covers: an extension gets a real
 * DOM, which is neither of these. `apps/extension/test/pipeline.test.ts` stands
 * in for it with linkedom's `DOMParser`, which is the closer approximation.
 */
export function documentFrom(html: string): Document {
  return parseHtml(html)
}

/**
 * An `Env` that throws on any network access not explicitly stubbed.
 *
 * This is the assertion that keeps the library honestly network-pure: an
 * extractor that starts fetching without being given a stub fails loudly in
 * tests rather than silently working in Node and breaking under MV3's CORS rules.
 */
export function strictEnv(
  stubs: {
    text?: Record<string, string>
    headers?: Record<string, Record<string, string>>
    now?: Date
  } = {},
): Env {
  const env: Env = {
    fetchText: async (url) => {
      const hit = stubs.text?.[url]
      if (hit === undefined) {
        throw new Error(`unstubbed network access: fetchText(${url})`)
      }
      return hit
    },
    fetchHeaders: async (url) => {
      const hit = stubs.headers?.[url]
      if (hit === undefined) {
        throw new Error(`unstubbed network access: fetchHeaders(${url})`)
      }
      return hit
    },
  }

  // Node has no global DOMParser, so the XML parser is injected here rather
  // than the library taking a dependency on one.
  env.parseXml = (xml) => {
    try {
      return new DOMParser().parseFromString(xml, 'text/xml') as unknown as Document
    } catch {
      return null
    }
  }

  if (stubs.now) {
    const fixed = stubs.now
    env.now = () => fixed
  }

  return env
}

/** Fixed "now" so plausibility checks are deterministic across runs. */
export const NOW = new Date('2026-07-28T12:00:00Z')
