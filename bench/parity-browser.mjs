/**
 * The parser the extension actually runs.
 *
 *   node bench/parity-browser.mjs [--limit 200]
 *
 * `parity.mjs` compares linkedom against node-html-parser. Both are Node
 * libraries, and neither is what ships: the extension gets a real browser DOM.
 * Every accuracy figure this project publishes is measured through Node, so
 * without this the extension's parser is the one in the chain nothing checks.
 *
 * Real Chromium, real `DOMParser`, the same corpus pages, the same extractor
 * bundle the content script carries. Exits non-zero on any disagreement, like
 * its sibling.
 *
 * Chromium is not a dependency of anything here. Install it into bench/, which
 * has its own node_modules for exactly this reason:
 *
 *   cd bench && npm install playwright-core && npx playwright install chromium
 */

import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const require = createRequire(join(HERE, 'package.json'))

const { values } = parseArgs({
  options: {
    limit: { type: 'string' },
    /** Where the browser bundle of the extractor is written. */
    bundle: { type: 'string', default: join(HERE, '.pagedate-browser.js') },
  },
})

const NOW = new Date('2026-01-01T00:00:00Z')

/**
 * The extractor, bundled for a browser.
 *
 * Built here rather than committed: it must be the *current* library, or the
 * comparison silently measures a stale copy against a fresh one and reports
 * agreement it has not earned.
 */
async function buildBrowserBundle(outfile) {
  const esbuild = require('esbuild')
  await esbuild.build({
    stdin: {
      contents: `import { extractFromDocument, resolveCandidates } from ${JSON.stringify(
        join(ROOT, 'packages', 'pagedate', 'dist', 'index.js'),
      )}\nglobalThis.__pagedate = { extractFromDocument, resolveCandidates }\n`,
      resolveDir: ROOT,
    },
    bundle: true,
    format: 'iife',
    outfile,
  })
  return readFile(outfile, 'utf8')
}

/** Compare only what a caller can observe: the ranked answer and the candidate set. */
const shape = (candidates, resolved) => ({
  published: resolved.published?.value ?? null,
  modified: resolved.modified?.value ?? null,
  count: candidates.length,
  // Sorted: document order can legitimately differ between parsers for
  // equal-ranked candidates, and that is not a parity failure by itself.
  values: candidates.map((c) => `${c.field}:${c.source}:${c.value}`).sort(),
})

async function main() {
  const { chromium } = require('playwright-core')
  const { parseHtml } = await import(join(ROOT, 'packages', 'pagedate', 'dist', 'node', 'index.js'))
  const { extractFromDocument, resolveCandidates } = await import(
    join(ROOT, 'packages', 'pagedate', 'dist', 'index.js')
  )

  const manifest = (await readFile(join(ROOT, 'corpus', 'manifest.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
    .filter((entry) => entry.fetch)

  const entries = values.limit ? manifest.slice(0, Number(values.limit)) : manifest

  const script = await buildBrowserBundle(values.bundle)

  // `channel: 'chromium'` selects the full browser rather than the headless
  // shell, which is a separate download and cannot host extensions.
  const browser = await chromium.launch({ channel: 'chromium', headless: true })

  /*
   * Nothing leaves the machine, and that is a correctness requirement rather
   * than a courtesy.
   *
   * These are archived pages: their images, scripts and stylesheets point at
   * hosts that may not resolve, may hang, or may be someone's live server being
   * hit once per corpus entry. Left alone, `setContent` waits for `load` and a
   * page whose subresources never arrive times out — which then reads as a
   * parser disagreement when it is nothing of the sort.
   *
   * Aborting every request also makes the comparison honest: what is being
   * compared is two HTML parsers, and a subresource cannot change how the markup
   * parses.
   *
   * A fresh page per document, and that is not defensive tidiness — reusing one
   * page silently corrupts the comparison. Measured: the first `setContent` on a
   * page yields the full 16 candidates for lenta.ru, and every subsequent one on
   * that same page yields 1, because the document is not cleanly replaced once
   * navigation requests are being aborted. A reused page reports the *browser*
   * as finding nothing and blames the parser for it.
   */
  const openPage = async () => {
    const page = await browser.newPage()
    await page.route('**/*', (route) => route.abort())
    return page
  }

  let checked = 0
  let agreed = 0
  const differences = []

  for (const entry of entries) {
    let html
    try {
      html = await readFile(join(ROOT, 'corpus', 'cache', `${entry.id}.html`), 'utf8')
    } catch {
      continue
    }

    let browserSide
    const page = await openPage()
    try {
      // `setContent` parses with the browser's own HTML parser — the whole point.
      // `domcontentloaded` rather than the default `load`: the DOM is what is
      // being compared, and waiting for subresources that are aborted anyway
      // only buys a timeout.
      await page.setContent(html, { timeout: 30_000, waitUntil: 'domcontentloaded' })
      await page.addScriptTag({ content: script })
      browserSide = await page.evaluate((nowIso) => {
        const candidates = globalThis.__pagedate.extractFromDocument(document, '')
        const resolved = globalThis.__pagedate.resolveCandidates(candidates, {
          now: new Date(nowIso),
        })
        return {
          published: resolved.published?.value ?? null,
          modified: resolved.modified?.value ?? null,
          count: candidates.length,
          values: candidates.map((c) => `${c.field}:${c.source}:${c.value}`).sort(),
        }
      }, NOW.toISOString())
    } catch (error) {
      differences.push({ id: entry.id, url: entry.url, reason: `browser: ${error.message}` })
      continue
    } finally {
      await page.close()
    }

    const document = parseHtml(html)
    const nodeCandidates = extractFromDocument(document, '')
    const nodeSide = shape(nodeCandidates, resolveCandidates(nodeCandidates, { now: NOW }))

    checked++
    if (
      nodeSide.published === browserSide.published &&
      nodeSide.modified === browserSide.modified
    ) {
      agreed++
    } else {
      differences.push({
        id: entry.id,
        url: entry.url,
        node: `${nodeSide.published} / ${nodeSide.modified}`,
        browser: `${browserSide.published} / ${browserSide.modified}`,
      })
    }

    if (checked % 100 === 0) console.log(`  ${checked}/${entries.length}…`)
  }

  await browser.close()

  console.log(`\n  real Chromium vs node-html-parser — ${checked} pages\n`)
  console.log(`    same answer          ${String(agreed).padStart(5)}`)
  console.log(`    DIFFERENT answer     ${String(differences.length).padStart(5)}`)

  for (const d of differences.slice(0, 20)) {
    console.log(`\n    ${d.url?.slice(0, 90) ?? d.id}`)
    console.log(`      node    ${d.node ?? '—'}`)
    console.log(`      browser ${d.browser ?? d.reason}`)
  }

  if (differences.length > 0) {
    console.log(`\n  Parsers DISAGREE. A published figure measured through`)
    console.log(`  node-html-parser does not describe what the extension does.`)
    process.exit(1)
  }
  console.log(`\n  Agreed on every page. The published figures describe the`)
  console.log(`  extension's browser DOM as well as the Node path.`)
}

await main()
