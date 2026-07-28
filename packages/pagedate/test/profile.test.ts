/**
 * Where does extraction time actually go?
 *
 *   pnpm --filter pagedate build
 *   node packages/pagedate/scripts/profile.ts
 *
 * Times each extractor separately over the corpus. Optimising without this is
 * guessing, and the guesses here are not obvious — a giant regex alternation
 * and a per-element Unicode normalisation are both plausible culprits.
 */

import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { parseHTML } from 'linkedom'
import { extractJsonLd } from '../src/extract/jsonld.js'
import { extractMeta } from '../src/extract/meta.js'
import { extractTimeTags } from '../src/extract/timeTags.js'
import { extractVisibleText } from '../src/extract/visibleText.js'
import { extractBareText } from '../src/extract/bareText.js'
import { extractUrlSlug } from '../src/extract/urlSlug.js'

const CORPUS = join(import.meta.dirname, '..', '..', '..', 'corpus-external', 'htmldate')
const CACHE = join(CORPUS, 'cache')
const FIXTURES = join(import.meta.dirname, '..', '..', '..', 'fixtures')

type Page = { url: string; html: string; label: string }

async function loadPages(): Promise<Page[]> {
  const pages: Page[] = []

  try {
    const index = JSON.parse(await readFile(join(CORPUS, 'eval_default.json'), 'utf8')) as Record<
      string,
      { file: string }
    >
    const cached = new Set(await readdir(CACHE))
    for (const [url, entry] of Object.entries(index)) {
      if (!cached.has(entry.file)) continue
      pages.push({ url, html: await readFile(join(CACHE, entry.file), 'utf8'), label: entry.file })
    }
  } catch {
    // corpus not downloaded; fixtures alone still give a signal
  }

  for (const slug of await readdir(FIXTURES).catch(() => [])) {
    try {
      const meta = JSON.parse(await readFile(join(FIXTURES, slug, 'expected.json'), 'utf8')) as {
        url: string
      }
      pages.push({
        url: meta.url,
        html: await readFile(join(FIXTURES, slug, 'page.html'), 'utf8'),
        label: slug,
      })
    } catch {
      // not a fixture directory
    }
  }

  return pages
}

async function main(): Promise<void> {
  const pages = await loadPages()
  if (pages.length === 0) {
    console.error('no pages found')
    process.exit(1)
  }

  const docs = pages.map((page) => {
    const { document } = parseHTML(page.html)
    return { ...page, doc: document as unknown as Document, url_: safeUrl(page.url) }
  })

  const stages: Array<[string, (p: (typeof docs)[number]) => unknown]> = [
    ['querySelectorAll(*)', (p) => p.doc.querySelectorAll('*').length],
    ['jsonld', (p) => extractJsonLd(p.doc)],
    ['meta', (p) => extractMeta(p.doc)],
    ['time-tags', (p) => extractTimeTags(p.doc)],
    ['url-slug', (p) => (p.url_ ? extractUrlSlug(p.url_) : [])],
    ['visible-text', (p) => extractVisibleText(p.doc, p.url_)],
    ['bare-text', (p) => extractBareText(p.doc, p.url_)],
  ]

  // One warm-up pass so JIT compilation is not attributed to the first stage.
  for (const page of docs) for (const [, run] of stages) run(page)

  const timings = new Map<string, number>()
  const ROUNDS = 3

  for (let round = 0; round < ROUNDS; round++) {
    for (const [name, run] of stages) {
      const started = performance.now()
      for (const page of docs) run(page)
      timings.set(name, (timings.get(name) ?? 0) + (performance.now() - started))
    }
  }

  const perPage = (total: number) => total / ROUNDS / docs.length

  console.log(`\n${docs.length} pages, ${ROUNDS} rounds\n`)
  const rows = [...timings.entries()].sort((a, b) => b[1] - a[1])
  const worst = rows[0]?.[1] ?? 1

  for (const [name, total] of rows) {
    const ms = perPage(total)
    const bar = '█'.repeat(Math.max(1, Math.round((total / worst) * 34)))
    console.log(`  ${name.padEnd(20)} ${ms.toFixed(3).padStart(7)} ms/page  ${bar}`)
  }

  const extractionTotal = rows
    .filter(([name]) => name !== 'querySelectorAll(*)')
    .reduce((sum, [, total]) => sum + total, 0)
  console.log(`\n  extraction total     ${perPage(extractionTotal).toFixed(3)} ms/page`)
}

function safeUrl(url: string): URL | null {
  try {
    return new URL(url)
  } catch {
    return null
  }
}

import { describe, it } from 'vitest'

/**
 * Opt-in: it takes several seconds and prints rather than asserts.
 *
 *   PROFILE=1 pnpm --filter pagedate test
 */
describe('profile', () => {
  it.skipIf(!process.env.PROFILE)('reports per-extractor cost', { timeout: 120_000 }, async () => {
    await main()
  })
})
