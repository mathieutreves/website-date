/**
 * Triage the remaining failures by *why* they fail, not by which page they are.
 *
 *   pnpm --filter pagedate build
 *   node packages/pagedate/scripts/triage.ts
 *
 * Three failure modes need three different fixes, and conflating them wastes
 * effort: a date we ranked below a worse one is a scoring problem, a date we
 * never produced is an extraction problem, and they share no code.
 */

import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { parseHTML } from 'linkedom'
import { extractFromDocument, resolveCandidates, type Candidate } from '../dist/index.js'

const CORPUS = join(import.meta.dirname, '..', '..', '..', 'corpus-external', 'htmldate')
const CACHE = join(CORPUS, 'cache')
const NOW = new Date('2026-01-01T00:00:00Z')

const MONTHS_DE = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember']
const MONTHS_EN = ['January','February','March','April','May','June','July','August','September','October','November','December']

function variants(iso: string): string[] {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number]
  const p = (n: number) => String(n).padStart(2, '0')
  const mi = m - 1
  return [
    iso, `${p(d)}.${p(m)}.${y}`, `${d}.${m}.${y}`, `${p(d)}/${p(m)}/${y}`,
    `${p(m)}/${p(d)}/${y}`, `${y}/${p(m)}/${p(d)}`,
    `${d}. ${MONTHS_DE[mi]} ${y}`, `${d}. ${MONTHS_DE[mi]?.slice(0,3)}`, `${d} ${MONTHS_EN[mi]} ${y}`,
    `${MONTHS_EN[mi]} ${d}, ${y}`, `${y}${p(m)}${p(d)}`, `${p(d)}.${p(m)}.${String(y).slice(2)}`,
  ].filter((v): v is string => Boolean(v))
}

function context(html: string, gold: string): string {
  for (const v of variants(gold)) {
    const at = html.indexOf(v)
    if (at < 0) continue
    return html.slice(Math.max(0, at - 130), at + v.length + 45).replace(/\s+/g, ' ').trim()
  }
  return '(gold string not present in the HTML in any recognised form)'
}

const show = (c: Candidate) =>
  `${c.value.slice(0, 16).padEnd(17)} ${c.field.padEnd(9)} ${c.confidence.padEnd(8)} ${c.source}`

async function main(): Promise<void> {
  const index = JSON.parse(await readFile(join(CORPUS, 'eval_default.json'), 'utf8')) as Record<
    string,
    { file: string; date: string }
  >
  const cached = new Set(await readdir(CACHE))

  const ranking: string[] = []
  const wrong: string[] = []
  const missing: string[] = []

  for (const [url, entry] of Object.entries(index)) {
    if (!cached.has(entry.file)) continue
    const html = await readFile(join(CACHE, entry.file), 'utf8')
    const { document } = parseHTML(html)

    const candidates = extractFromDocument(document as unknown as Document, url)
    const result = resolveCandidates(candidates, { now: NOW })
    const got = result.published?.value.slice(0, 10) ?? null
    if (got === entry.date) continue

    const hit = candidates.find((c) => c.value.slice(0, 10) === entry.date)

    if (hit) {
      ranking.push(
        `  ${entry.file}  gold=${entry.date}\n` +
          `    WANTED   ${show(hit)}\n` +
          `    CHOSEN   ${result.published ? show(result.published) : '(nothing)'}`,
      )
    } else if (got !== null) {
      wrong.push(
        `  ${entry.file}  gold=${entry.date}\n` +
          `    CHOSEN   ${show(result.published!)}\n` +
          `    gold sits in: …${context(html, entry.date).slice(0, 150)}…`,
      )
    } else {
      missing.push(
        `  ${entry.file}  gold=${entry.date}  (${candidates.length} candidates, none right)\n` +
          `    gold sits in: …${context(html, entry.date).slice(0, 150)}…`,
      )
    }
  }

  for (const [title, rows] of [
    ['1. RANKING — the right date was extracted but lost', ranking],
    ['2. WRONG — a different date was chosen', wrong],
    ['3. MISSING — the right date was never extracted', missing],
  ] as const) {
    console.log(`\n${'='.repeat(78)}\n${title}  (${rows.length})\n${'='.repeat(78)}`)
    console.log(rows.join('\n\n'))
  }
}

await main()
