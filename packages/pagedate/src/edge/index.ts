/**
 * Edge entry point — `pagedate/edge`.
 *
 * For Cloudflare Workers, Deno, Bun, and any other runtime that has `fetch` but
 * not Node's built-in modules. Nothing here imports `node:` anything, and
 * `test/edge.test.ts` asserts that against the built bundle rather than trusting
 * it — a single `node:module` import reached by a rarely-taken branch is exactly
 * the kind of thing that passes review and fails at deploy time.
 *
 * ## What this adds over the main entry
 *
 * Only {@link webEnv}. `pagedate` itself is runtime-agnostic — it reads a
 * `Document` and touches no platform API beyond the DOM — so the extractors were
 * never the obstacle to running here. The `Env` is: feed and sitemap lookups
 * need a redirect walk, a timeout and a capped read, and the alternative to
 * shipping one is every caller writing their own. `webEnv` is that, and it is
 * the same code `pagedate/node` runs.
 *
 * ## You still bring your own HTML parser
 *
 * Deliberately, and it is the one piece of friction that does not go away. This
 * package ships no parser because in its first-class environment — a browser, an
 * extension content script — the DOM already exists and bundling one would be
 * dead weight. An edge runtime has no DOM, so something has to build the
 * `Document`, and the right something depends on where you are:
 *
 * ```js
 * // Cloudflare Workers / Bun: node-html-parser runs fine and is what the
 * // published accuracy figures were measured through.
 * import { parse } from 'node-html-parser'
 * import { findDates, webEnv } from 'pagedate/edge'
 *
 * export default {
 *   async fetch(request) {
 *     const target = new URL(request.url).searchParams.get('url')
 *     const env = webEnv()
 *     const html = await env.fetchText(target)
 *     if (!html) return Response.json({ error: 'unreachable' }, { status: 502 })
 *
 *     const doc = parse(html)
 *     const result = await findDates(doc, target, env)
 *     return Response.json(result)
 *   },
 * }
 * ```
 *
 * ```js
 * // Deno: the global DOMParser is real, so there is nothing to install and
 * // webEnv() picks it up for the XML paths automatically.
 * const doc = new DOMParser().parseFromString(html, 'text/html')
 * ```
 *
 * ## Two caveats worth reading before you deploy
 *
 * **`blockPrivateNetwork: 'strict'` degrades to `'literal'`** unless you pass a
 * {@link FetchEnvOptions.resolveHostname}, because there is no portable DNS
 * resolver to reach for. `'literal'` still blocks private, loopback, link-local
 * and metadata *addresses* on every redirect hop, which is the check that
 * matters most; what you lose is "a public hostname that resolves to
 * 127.0.0.1". On Workers the platform blocks most of that range at the socket
 * anyway.
 *
 * **Cloudflare Workers has no `DOMParser`**, so feed and sitemap XML is skipped
 * there unless you pass {@link FetchEnvOptions.parseXml}. That costs the RSS,
 * Atom and `<lastmod>` signals — which is what makes an undated static-site post
 * solvable — so if you are analysing blogs rather than news, supply one.
 */

export * from '../index.js'

export { fetchEnv as webEnv, readCapped, DEFAULT_USER_AGENT } from '../fetchEnv.js'
export type {
  FetchEnvOptions as WebEnvOptions,
  BlockPrivateNetwork,
} from '../fetchEnv.js'
