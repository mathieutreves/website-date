import { DOMParser, parseHTML } from 'linkedom'
import type { Env } from '../src/types.js'

/**
 * Build a `Document` from an HTML string.
 *
 * linkedom's Document is structurally compatible with the subset of the DOM the
 * library uses, but not nominally identical to lib.dom's, hence the cast — it is
 * confined to this helper rather than spread through the tests.
 */
export function documentFrom(html: string): Document {
  const { document } = parseHTML(html)
  return document as unknown as Document
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
