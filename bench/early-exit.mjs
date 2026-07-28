/**
 * Can we skip parsing most of the document?
 *
 * Parsing dominates the Node path — ~10 ms of a ~15 ms page. But the signals
 * that produce a *declared* answer (JSON-LD, meta tags) all live in <head>,
 * which is a small fraction of the bytes. If a head-only parse answers a page
 * at declared confidence, and that answer agrees with what the full parse
 * would have said, the rest of the document never needed to be built.
 *
 * This measures three things, in order of importance:
 *   1. Agreement  — when head-only answers at `declared`, is it the same answer?
 *   2. Coverage   — how many pages does that cover?
 *   3. Saving     — what does the truncated parse actually cost?
 *
 * Agreement first: a fast path that changes answers is not an optimisation.
 *
 *   node bench/early-exit.mjs
 */

import { readFile, readdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseHTML } from 'linkedom'
import { extractFromDocument, resolveCandidates } from '../packages/pagedate/dist/index.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const CORPUS = join(HERE, '..', 'corpus-external', 'htmldate')
const CACHE = join(CORPUS, 'cache')
const NOW = new Date('2026-01-01T00:00:00Z')

/**
 * The bytes a head-only pass would have to parse.
 *
 * `</head>` is the honest boundary; when a page omits it, the first `<body`
 * serves. The cap is a backstop for pages that are one long <head> or have
 * neither marker — without it a pathological page silently parses in full.
 */
const CAP = 256 * 1024
function headSlice(html) {
  const close = html.search(/<\/head\s*>/i)
  if (close !== -1) return { html: html.slice(0, close + 7), bounded: true }
  const body = html.search(/<body[\s>]/i)
  if (body !== -1) return { html: html.slice(0, body), bounded: true }
  return { html: html.slice(0, CAP), bounded: false }
}

const publishedOf = (doc, url) => {
  try {
    const result = resolveCandidates(extractFromDocument(doc, url, { mode: 'standard' }), {
      now: NOW,
    })
    return result.published ?? null
  } catch {
    return null
  }
}

const day = (p) => p?.value.slice(0, 10) ?? null

async function main() {
  const index = JSON.parse(await readFile(join(CORPUS, 'eval_default.json'), 'utf8'))
  const cached = new Set(await readdir(CACHE))

  const pages = []
  for (const [url, entry] of Object.entries(index)) {
    if (!cached.has(entry.file)) continue
    pages.push({ url, gold: entry.date, html: await readFile(join(CACHE, entry.file), 'utf8') })
  }

  let headBytes = 0, fullBytes = 0
  for (const p of pages) {
    headBytes += headSlice(p.html).html.length
    fullBytes += p.html.length
  }
  console.log(`\n=== BYTES ===\n`)
  console.log(`  <head> is ${((headBytes / fullBytes) * 100).toFixed(1)}% of corpus bytes` +
    ` (${Math.round(headBytes / pages.length / 1024)} KB vs ${Math.round(fullBytes / pages.length / 1024)} KB per page)`)

  // --- Agreement and coverage -------------------------------------------
  const rows = []
  for (const p of pages) {
    const full = publishedOf(parseHTML(p.html).document, p.url)
    const head = publishedOf(parseHTML(headSlice(p.html).html).document, p.url)
    rows.push({ ...p, full, head })
  }

  const declaredHead = rows.filter((r) => r.head?.confidence === 'declared')
  const agree = declaredHead.filter((r) => day(r.head) === day(r.full))
  const disagree = declaredHead.filter((r) => day(r.head) !== day(r.full))

  console.log(`\n=== EARLY EXIT ON \`declared\` FROM <head> ===\n`)
  console.log(`  pages where head-only answers at declared : ${declaredHead.length} / ${pages.length}` +
    ` (${((declaredHead.length / pages.length) * 100).toFixed(0)}%)`)
  console.log(`  of those, same answer as the full parse   : ${agree.length}`)
  console.log(`  of those, DIFFERENT from the full parse   : ${disagree.length}`)

  if (disagree.length) {
    console.log(`\n  pages where exiting early would change the answer:`)
    for (const r of disagree) {
      const host = new URL(r.url).hostname.replace(/^www\./, '')
      console.log(
        `    ${host.padEnd(26)} head=${String(day(r.head)).padEnd(11)} full=${String(day(r.full)).padEnd(11)}` +
          ` gold=${r.gold}  ${day(r.head) === r.gold ? '(head right)' : day(r.full) === r.gold ? '(head WRONG)' : '(both wrong)'}`,
      )
    }
  }

  // Accuracy if the fast path is taken wherever it fires.
  const hybrid = rows.map((r) => (r.head?.confidence === 'declared' ? r.head : r.full))
  const acc = (list) => list.filter((v, i) => day(v) === rows[i].gold).length
  console.log(`\n  exact hits, always full parse : ${acc(rows.map((r) => r.full))} / ${pages.length}`)
  console.log(`  exact hits, hybrid early exit : ${acc(hybrid)} / ${pages.length}`)

  // --- Cost --------------------------------------------------------------
  console.log(`\n=== COST PER PAGE ===\n`)
  const time = (label, fn) => {
    for (const p of pages.slice(0, 10)) fn(p) // warm-up
    const started = performance.now()
    for (const p of pages) fn(p)
    const ms = (performance.now() - started) / pages.length
    console.log(`  ${label.padEnd(34)} ${ms.toFixed(2).padStart(6)} ms`)
    return ms
  }

  const full = time('linkedom, whole document', (p) => parseHTML(p.html).document)
  const head = time('linkedom, <head> only', (p) => parseHTML(headSlice(p.html).html).document)
  time('linkedom, whole doc + extract', (p) => publishedOf(parseHTML(p.html).document, p.url))
  time('linkedom, <head> only + extract', (p) => publishedOf(parseHTML(headSlice(p.html).html).document, p.url))

  const hitRate = declaredHead.length / pages.length
  const blended = hitRate * head + (1 - hitRate) * (head + full)
  console.log(
    `\n  blended parse cost at a ${(hitRate * 100).toFixed(0)}% hit rate : ${blended.toFixed(2)} ms` +
      ` (vs ${full.toFixed(2)} ms always-full)`,
  )
  console.log(
    `  note: a miss pays BOTH parses — ${head.toFixed(2)} + ${full.toFixed(2)} ms — unless the` +
      ` head slice is reused.`,
  )
}

await main()
