/**
 * Does corroboration predict correctness?
 *
 *   node scripts/corpus/agreement.ts
 *
 * `resolve` currently ranks on confidence → source → precision and ignores
 * agreement entirely: a date backed by four signals scores the same as one
 * backed by one. This measures whether that is leaving information on the table,
 * before any behaviour is changed.
 *
 * Two counts are reported side by side, because they disagree and the difference
 * is the whole point:
 *
 *   - **sources** — how many candidates share the winning date. Naive.
 *   - **classes** — how many *independent* channels do. JSON-LD, OpenGraph,
 *     `itemprop` and Dublin Core are usually one CMS field rendered four ways,
 *     so counting them as four confirmations measures template consistency, not
 *     corroboration. This is the same independence problem `holdOut` solves for
 *     labels.
 *
 * The URL is neutralised, as in score.ts: these labels were read out of the URL,
 * so the `url` class cannot be scored against them without circularity. That
 * limits this to CMS-vs-text corroboration until the feed tier lands.
 */

import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { readManifest } from './schema.ts'

const ROOT = join(import.meta.dirname, '..', '..')
const MANIFEST = join(ROOT, 'corpus', 'manifest.jsonl')
const CACHE = join(ROOT, 'corpus', 'cache')
const NOW = new Date('2026-01-01T00:00:00Z')

const require = createRequire(join(ROOT, 'packages', 'pagedate', 'package.json'))
// The parser `pagedate/node` ships, so this scores what callers actually run.
const { parseHtml } = await import(join(ROOT, 'packages', 'pagedate', 'dist', 'node', 'index.js'))
const { extractFromDocument, resolveCandidates } = await import(
  join(ROOT, 'packages', 'pagedate', 'dist', 'index.js')
)

/**
 * Independence classes. Two members of the same class agreeing is one signal.
 *
 * The CMS class is deliberately broad: every one of those is written from the
 * same field by the same template, so their agreement is guaranteed rather than
 * informative.
 */
const CLASS_OF: Record<string, string> = {
  jsonld: 'cms', opengraph: 'cms', itemprop: 'cms', 'dublin-core': 'cms',
  sailthru: 'cms', parsely: 'cms', 'meta-date': 'cms', citation: 'cms',
  wordpress: 'cms', feed: 'cms',
  'url-slug': 'url', 'image-path': 'url',
  'visible-text': 'text', 'marked-date': 'text', 'text-date': 'text', 'time-tag': 'text',
  'http-last-modified': 'server', sitemap: 'server',
}
const classOf = (source: string): string => CLASS_OF[source] ?? 'other'

const neutralise = (rawUrl: string): string => {
  try {
    const u = new URL(rawUrl)
    u.pathname = u.pathname
      .replace(/\/(19|20)\d{2}\/\d{1,2}\/\d{1,2}(?=\/|$)/g, '/yr/mo/dy')
      .replace(/\/(19|20)\d{2}-\d{2}-\d{2}/g, '/yr-mo-dy')
    return u.toString()
  } catch {
    return rawUrl
  }
}

const splitOf = (host: string): string =>
  createHash('sha1').update(host).digest()[0] % 3 === 0 ? 'test' : 'dev'

type Bucket = { n: number; right: number }
const report = (title: string, buckets: Map<number, Bucket>, unit: string): void => {
  console.log(`\n  ${title}`)
  console.log(`    ${unit.padEnd(22)}  pages   correct   accuracy`)
  for (const [k, b] of [...buckets.entries()].sort((a, b) => a[0] - b[0])) {
    console.log(
      `    ${String(k).padEnd(22)} ${String(b.n).padStart(6)} ${String(b.right).padStart(9)}` +
        `   ${((b.right / b.n) * 100).toFixed(1).padStart(6)}%`,
    )
  }
}

async function main(): Promise<void> {
  const entries = readManifest(await readFile(MANIFEST, 'utf8')).filter(
    (e) =>
      e.fetch &&
      e.label.published &&
      e.label.source === 'url-permalink' &&
      e.strata.labelInPage !== false &&
      e.captureLagDays <= 30 &&
      splitOf(e.strata.host) === 'dev',
  )

  console.log(`\n${entries.length} dev pages (url-permalink labels, URL neutralised)`)

  for (const mode of ['standard', 'extensive']) {
    const bySources = new Map<number, Bucket>()
    const byClasses = new Map<number, Bucket>()
    const bump = (m: Map<number, Bucket>, k: number, right: boolean): void => {
      const b = m.get(k) ?? { n: 0, right: 0 }
      b.n++
      if (right) b.right++
      m.set(k, b)
    }

    for (const entry of entries) {
      let html: string
      try {
        html = await readFile(join(CACHE, `${entry.id}.html`), 'utf8')
      } catch {
        continue
      }
      const document = parseHtml(html)
      const candidates = extractFromDocument(document, neutralise(entry.url), { mode })
      const winner = resolveCandidates(candidates, { now: NOW }).published
      if (!winner) continue

      const day = winner.value.slice(0, 10)
      const agreeing = candidates.filter(
        (c: { value: string; field: string }) =>
          c.value.slice(0, 10) === day && c.field !== 'modified',
      )
      const sources = new Set(agreeing.map((c: { source: string }) => c.source)).size
      const classes = new Set(agreeing.map((c: { source: string }) => classOf(c.source))).size
      const right = day === entry.label.published

      bump(bySources, sources, right)
      bump(byClasses, classes, right)
    }

    console.log(`\n=== mode=${mode} ===`)
    report('naive: distinct sources agreeing', bySources, 'sources')
    report('independence classes agreeing', byClasses, 'classes')
  }
}

await main()
