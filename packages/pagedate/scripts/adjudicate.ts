/**
 * Evidence for every page where pagedate and htmldate disagree.
 *
 *   python3 scripts/bench_python.py > /tmp/bench-python.jsonl
 *   node packages/pagedate/scripts/adjudicate.ts
 *
 * A benchmark score is only as good as its gold standard, and several golds in
 * this corpus point at dates belonging to other documents. This prints, for
 * each disagreement, where the gold date physically sits in the HTML — which is
 * usually enough to tell a publication date from an artifact.
 *
 * It cuts both ways: where a gold is an artifact and htmldate matched it,
 * htmldate was credited for a wrong answer.
 */

import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { parseHTML } from 'linkedom'
import { extractFromDocument, resolveCandidates } from '../dist/index.js'

const ROOT = join(import.meta.dirname, '..', '..', '..')
const CORPUS = join(ROOT, 'corpus-external', 'htmldate')
const CACHE = join(CORPUS, 'cache')
const NOW = new Date('2026-01-01T00:00:00Z')

const MONTHS_DE = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember']
const MONTHS_EN = ['January','February','March','April','May','June','July','August','September','October','November','December']

/** Every plausible rendering of a date, so we can find where the gold lives. */
function variants(iso: string): string[] {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number]
  const p = (n: number) => String(n).padStart(2, '0')
  const mi = m - 1
  return [
    iso,
    `${p(d)}.${p(m)}.${y}`, `${d}.${m}.${y}`,
    `${p(d)}/${p(m)}/${y}`, `${p(m)}/${p(d)}/${y}`, `${y}/${p(m)}/${p(d)}`,
    `${d}. ${MONTHS_DE[mi]} ${y}`, `${d} ${MONTHS_EN[mi]} ${y}`, `${MONTHS_EN[mi]} ${d}, ${y}`,
    `${y}${p(m)}${p(d)}`,
  ].filter(Boolean)
}

/** Classify the markup the gold date sits in — that decides whether it is real. */
function locate(html: string, gold: string): { kind: string; snippet: string } | null {
  for (const variant of variants(gold)) {
    const at = html.indexOf(variant)
    if (at < 0) continue

    const before = html.slice(Math.max(0, at - 300), at).toLowerCase()
    const snippet = html
      .slice(Math.max(0, at - 120), at + variant.length + 40)
      .replace(/\s+/g, ' ')
      .trim()

    // Ordered by how strongly each implies the date is NOT this page's own.
    let kind = 'text'
    if (/href\s*=\s*["'][^"']*$/.test(before)) kind = 'INSIDE A LINK HREF'
    else if (/(src|data-permalink|data-orig-file|content)\s*=\s*["'][^"']*$/.test(before))
      kind = 'INSIDE A URL/ASSET PATH'
    else if (/\?[^"'<>]*$/.test(before)) kind = 'INSIDE A QUERY STRING'
    else if (/<script[^>]*>(?:(?!<\/script>)[\s\S])*$/.test(before)) kind = 'inside a script'
    else if (/<meta[^>]*$/.test(before)) kind = 'meta tag'
    else if (/datetime\s*=\s*["'][^"']*$/.test(before)) kind = '<time datetime>'

    return { kind, snippet }
  }
  return null
}

async function main(): Promise<void> {
  const index = JSON.parse(await readFile(join(CORPUS, 'eval_default.json'), 'utf8')) as Record<
    string,
    { file: string; date: string }
  >
  const cached = new Set(await readdir(CACHE))

  const htmldate = new Map<string, string | null>()
  try {
    const text = await readFile('/tmp/bench-python.jsonl', 'utf8')
    for (const line of text.split('\n').filter(Boolean)) {
      const row = JSON.parse(line) as { tool: string; file: string; found: string | null }
      if (row.tool === 'htmldate (extensive)') htmldate.set(row.file, row.found)
    }
  } catch {
    console.error('run scripts/bench_python.py first')
    process.exit(1)
  }

  const buckets = new Map<string, string[]>()
  let agree = 0

  for (const [url, entry] of Object.entries(index)) {
    if (!cached.has(entry.file)) continue
    const html = await readFile(join(CACHE, entry.file), 'utf8')
    const { document } = parseHTML(html)

    let ours: string | null = null
    try {
      ours =
        resolveCandidates(extractFromDocument(document as unknown as Document, url), { now: NOW })
          .published?.value.slice(0, 10) ?? null
    } catch {
      ours = null
    }

    const theirs = htmldate.get(entry.file) ?? null
    if (ours === theirs) {
      agree++
      continue
    }

    const found = locate(html, entry.date)
    const suspect = found?.kind.startsWith('INSIDE') ?? false
    const bucket = suspect ? 'GOLD LOOKS LIKE AN ARTIFACT' : `gold in ${found?.kind ?? 'not found'}`

    const lines = buckets.get(bucket) ?? []
    lines.push(
      `    ${entry.file}\n` +
        `      gold=${entry.date}  pagedate=${ours ?? '—'}  htmldate=${theirs ?? '—'}\n` +
        `      ${found ? `…${found.snippet}…` : '(gold string not present in the HTML)'}`,
    )
    buckets.set(bucket, lines)
  }

  console.log(`\n${agree} pages where both tools agree; disagreements below\n`)

  const sorted = [...buckets.entries()].sort((a, b) => b[1].length - a[1].length)
  for (const [kind, entries] of sorted) {
    console.log(`\n${'='.repeat(74)}\n${kind}  (${entries.length})\n${'='.repeat(74)}`)
    console.log(entries.join('\n\n'))
  }

  console.log('\n\nSUMMARY')
  for (const [kind, entries] of sorted) {
    console.log(`  ${String(entries.length).padStart(3)}  ${kind}`)
  }
}

await main()
