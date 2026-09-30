/**
 * Why a page failed, page by page.
 *
 *   node scripts/corpus/diagnose.ts --split dev
 *   node scripts/corpus/diagnose.ts --split dev --lang de
 *   node scripts/corpus/diagnose.ts --split diag --host example.com --verbose
 *
 * `score.ts` reports that German is at 58%. This reports *which* German pages,
 * what the extractor returned instead, which candidates it had to choose from,
 * and what date-shaped text sits in the document that nothing picked up. That is
 * the difference between knowing there is a problem and being able to fix it.
 *
 * **Never point this at `--split test`.** It exists to be read, and reading the
 * held-out split is what stops it being held out; the flag is deliberately not
 * defaulted and `test` is refused outright below. `diag` is the pool carved out
 * for exactly this, and `dev` has always been fair game.
 *
 * The three failure shapes it separates, because they need different fixes:
 *
 * - **wrong** — a date was found and it is not the label. Either the wrong
 *   candidate won a ranking contest, or a signal was misparsed. The candidate
 *   dump shows which.
 * - **missed, label in page** — the date is in the document and no extractor
 *   saw it. This is the recoverable pile, and the one worth working.
 * - **missed, label absent** — the label came from the URL and the page never
 *   restates it. Nothing can find it; `score.ts` already excludes these by
 *   default and they appear here only under `--include-unanswerable`.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { isNegative, readManifest, splitOf, type CorpusEntry } from './schema.ts'

const ROOT = join(import.meta.dirname, '..', '..')
const MANIFEST = join(ROOT, 'corpus', 'manifest.jsonl')
const CACHE = join(ROOT, 'corpus', 'cache')

const { parseHtml } = await import(join(ROOT, 'packages', 'pagedate', 'dist', 'node', 'index.js'))
const { extractFromDocument, resolveCandidates } = await import(
  join(ROOT, 'packages', 'pagedate', 'dist', 'index.js')
)

const { values } = parseArgs({
  options: {
    split: { type: 'string', default: 'dev' },
    mode: { type: 'string', default: 'standard' },
    lang: { type: 'string' },
    host: { type: 'string' },
    era: { type: 'string' },
    /** 'wrong' | 'missed' | 'all' */
    kind: { type: 'string', default: 'all' },
    'max-lag': { type: 'string', default: '30' },
    limit: { type: 'string', default: '25' },
    verbose: { type: 'boolean', default: false },
    'include-unanswerable': { type: 'boolean', default: false },
    /** Group failures by host and print counts only. */
    hosts: { type: 'boolean', default: false },
  },
})

if (values.split === 'test') {
  console.error(
    'Refusing to diagnose the held-out split.\n' +
      'Reading these pages is what stops them being held out. Use --split diag.',
  )
  process.exit(2)
}

const neutralise = (rawUrl: string): string =>
  rawUrl
    .replace(/\/(19|20)\d{2}\/\d{1,2}\/\d{1,2}(?=\/|$|[?#])/g, '/yr/mo/dy')
    .replace(/\/(19|20)\d{2}-\d{2}-\d{2}/g, '/yr-mo-dy')

function neutraliseDeclaredUrls(doc: Document): void {
  for (const el of doc.querySelectorAll('link[rel="canonical"]')) {
    const href = el.getAttribute('href')
    if (href) el.setAttribute('href', neutralise(href))
  }
  for (const el of doc.querySelectorAll('meta[property="og:url"], meta[name="og:url"]')) {
    const content = el.getAttribute('content')
    if (content) el.setAttribute('content', neutralise(content))
  }
}

const capturedAt = (entry: CorpusEntry): Date => {
  const s = entry.snapshot
  return new Date(
    `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(8, 10)}:${s.slice(10, 12)}:${s.slice(12, 14)}Z`,
  )
}

const strip = (html: string): string =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')

/**
 * Where the label date appears in the document, in whatever form.
 *
 * Deliberately not the library's own parser: the question is "was this findable
 * and we missed it", and asking our own extractor that gives the answer we
 * already have. A plain search for the day, month name and year near each other
 * says whether a human would have seen it.
 */
function whereIsTheLabel(html: string, label: string): string[] {
  const [y, m, d] = label.split('-')
  const body = strip(html)
  const out: string[] = []
  const day = String(Number(d))
  const month = String(Number(m))
  const patterns = [
    new RegExp(`${y}[-/.]${m}[-/.]${d}`, 'g'),
    new RegExp(`${d}[-/.]${m}[-/.]${y}`, 'g'),
    new RegExp(`${day}[-/. ]{1,3}${month}[-/. ]{1,3}${y}`, 'g'),
    new RegExp(`${y}\\D{1,3}${month}\\D{1,3}${day}\\D`, 'g'),
    new RegExp(`\\b${day}\\b[^.<>]{0,18}\\b${y}\\b`, 'gi'),
  ]
  for (const pattern of patterns) {
    for (const match of body.matchAll(pattern)) {
      const at = match.index ?? 0
      out.push(`…${body.slice(Math.max(0, at - 55), at + match[0].length + 55).trim()}…`)
      if (out.length >= 6) return out
    }
  }
  return out
}

async function main(): Promise<void> {
  const all = readManifest(await readFile(MANIFEST, 'utf8'))
  let entries = all.filter((e) => e.fetch && !isNegative(e) && e.label.published)
  entries = entries.filter((e) => splitOf(e.strata.host) === values.split)
  entries = entries.filter((e) => e.captureLagDays <= Number(values['max-lag']))
  if (!values['include-unanswerable']) {
    entries = entries.filter((e) => e.strata.labelInPage !== false)
  }
  if (values.lang) entries = entries.filter((e) => (e.strata.lang ?? 'unknown') === values.lang)
  if (values.host) entries = entries.filter((e) => e.strata.host === values.host)
  if (values.era) entries = entries.filter((e) => String(e.strata.era) === values.era)

  const failures: Array<{
    entry: CorpusEntry
    found: string | null
    source: string | null
    candidates: Array<{ value: string; source: string; confidence: string; field: string }>
    kind: 'wrong' | 'missed'
  }> = []

  for (const entry of entries) {
    let html: string
    try {
      html = await readFile(join(CACHE, `${entry.id}.html`), 'utf8')
    } catch {
      continue
    }
    const document = parseHtml(html)
    const holdOut = new Set(entry.holdOut)
    const urlHeldOut = holdOut.has('url-slug')
    const scoringUrl = urlHeldOut ? neutralise(entry.url) : entry.url
    if (urlHeldOut) neutraliseDeclaredUrls(document)

    const candidates = extractFromDocument(document, scoringUrl, { mode: values.mode })
    const kept = candidates.filter((c: any) => !holdOut.has(c.source))
    const resolved = resolveCandidates(kept, { now: capturedAt(entry) })
    const published = resolved.published
    const found = published?.value.slice(0, 10) ?? null
    const label = entry.label.published!

    if (found !== null) {
      const width = Math.min(label.length, found.length)
      if (label.slice(0, width) === found.slice(0, width)) continue
    }
    failures.push({
      entry,
      found,
      source: published?.source ?? null,
      candidates: kept.map((c: any) => ({
        value: c.value,
        source: c.source,
        confidence: c.confidence,
        field: c.field,
      })),
      kind: found === null ? 'missed' : 'wrong',
    })
  }

  const selected =
    values.kind === 'all' ? failures : failures.filter((f) => f.kind === values.kind)

  console.log(
    `\n${entries.length} pages in scope, ${failures.length} failures ` +
      `(${failures.filter((f) => f.kind === 'wrong').length} wrong, ` +
      `${failures.filter((f) => f.kind === 'missed').length} missed)\n`,
  )

  if (values.hosts) {
    const byHost = new Map<string, { wrong: number; missed: number; lang: string }>()
    for (const f of selected) {
      const key = f.entry.strata.host
      const row = byHost.get(key) ?? { wrong: 0, missed: 0, lang: f.entry.strata.lang ?? '?' }
      row[f.kind]++
      byHost.set(key, row)
    }
    console.log(`  ${'host'.padEnd(34)} ${'lang'.padEnd(6)} wrong  missed  total`)
    for (const [host, r] of [...byHost.entries()].sort(
      (a, b) => b[1].wrong + b[1].missed - (a[1].wrong + a[1].missed),
    )) {
      console.log(
        `  ${host.padEnd(34)} ${r.lang.padEnd(6)} ${String(r.wrong).padStart(5)} ` +
          `${String(r.missed).padStart(7)} ${String(r.wrong + r.missed).padStart(6)}`,
      )
    }
    return
  }

  for (const f of selected.slice(0, Number(values.limit))) {
    const e = f.entry
    console.log('─'.repeat(100))
    console.log(
      `${f.kind.toUpperCase()}  ${e.strata.host}  lang=${e.strata.lang ?? '?'}  era=${e.strata.era}  lag=${e.captureLagDays}d`,
    )
    console.log(`  label  ${e.label.published}`)
    console.log(`  found  ${f.found ?? '—'}${f.source ? `  (${f.source})` : ''}`)
    console.log(`  url    ${e.url.slice(0, 110)}`)
    if (f.candidates.length) {
      console.log(`  candidates (${f.candidates.length}):`)
      for (const c of f.candidates.slice(0, 10)) {
        console.log(`    ${c.value.padEnd(26)} ${c.source.padEnd(18)} ${c.confidence.padEnd(9)} ${c.field}`)
      }
    } else {
      console.log(`  candidates: NONE`)
    }
    if (values.verbose) {
      let html = ''
      try {
        html = await readFile(join(CACHE, `${e.id}.html`), 'utf8')
      } catch {
        /* ignore */
      }
      const spots = whereIsTheLabel(html, e.label.published!)
      if (spots.length) {
        console.log(`  the label appears here:`)
        for (const s of spots) console.log(`    ${s.slice(0, 150)}`)
      } else {
        console.log(`  the label does not appear in the rendered text in any obvious form`)
      }
    }
  }
  if (selected.length > Number(values.limit)) {
    console.log(`\n… ${selected.length - Number(values.limit)} more (--limit)`)
  }
}

await main()
