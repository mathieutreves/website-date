/**
 * Why does node-html-parser lose pages that linkedom finds?
 *
 * BENCHMARK.md records that node-html-parser parses 3x faster but returns
 * `null` on 14 of 55 pages. A uniform null — never a *wrong* date — points at
 * a subtree the parser never built, not at a different heuristic. This script
 * localises which signal disappears, so the choice is "this parser drops
 * JSON-LD" rather than "this parser sees less".
 *
 *   node bench/parser-nulls.mjs
 */

import { readFile, readdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractFromDocument, resolveCandidates } from '../packages/pagedate/dist/index.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const CORPUS = join(HERE, '..', 'corpus-external', 'htmldate')
const CACHE = join(CORPUS, 'cache')
const NOW = new Date('2026-01-01T00:00:00Z')

const { parseHTML } = await import('linkedom')
const { parse: parseNhp } = await import('node-html-parser')

/** Parser variants worth separating: the defaults may simply be wrong for us. */
const VARIANTS = {
  linkedom: (html) => parseHTML(html).document,
  'nhp (default)': (html) => parseNhp(html),
  // node-html-parser skips <script>/<style>/<pre> bodies unless told otherwise,
  // and drops comments. JSON-LD lives inside a <script>, so this is the first
  // thing to rule in or out.
  'nhp (+script)': (html) =>
    parseNhp(html, {
      comment: true,
      blockTextElements: { script: true, noscript: true, style: false, pre: true },
    }),
}

const answer = (doc, url) => {
  try {
    return (
      resolveCandidates(extractFromDocument(doc, url, { mode: 'standard' }), { now: NOW })
        .published?.value.slice(0, 10) ?? null
    )
  } catch (error) {
    return `ERR:${error.message.slice(0, 40)}`
  }
}

/** Which extractor produced the winning candidate, and what else was on offer. */
const winner = (doc, url) => {
  try {
    const candidates = extractFromDocument(doc, url, { mode: 'standard' })
    const published = resolveCandidates(candidates, { now: NOW }).published
    if (!published) return { source: null, total: candidates.length }
    return { source: published.source, total: candidates.length }
  } catch {
    return { source: null, total: 0 }
  }
}

/** Structural probes: what does each parser actually expose? */
const probe = (doc) => {
  const count = (sel) => {
    try {
      return doc.querySelectorAll(sel).length
    } catch {
      return -1
    }
  }
  let jsonLdBytes = 0
  try {
    for (const el of doc.querySelectorAll('script[type="application/ld+json"]')) {
      jsonLdBytes += (el.textContent ?? '').length
    }
  } catch {}
  return {
    elements: count('*'),
    meta: count('meta'),
    time: count('time'),
    jsonld: count('script[type="application/ld+json"]'),
    jsonLdBytes,
    body: count('body *'),
  }
}

async function main() {
  const index = JSON.parse(await readFile(join(CORPUS, 'eval_default.json'), 'utf8'))
  const cached = new Set(await readdir(CACHE))

  const pages = []
  for (const [url, entry] of Object.entries(index)) {
    if (!cached.has(entry.file)) continue
    pages.push({ url, gold: entry.date, html: await readFile(join(CACHE, entry.file), 'utf8') })
  }

  // Accuracy per variant, so a "fix" that trades nulls for wrong answers shows.
  console.log(`\n=== ANSWERS PER PARSER (${pages.length} pages, standard mode) ===\n`)
  const answers = {}
  for (const [name, parse] of Object.entries(VARIANTS)) {
    const found = pages.map((p) => {
      try {
        return answer(parse(p.html), p.url)
      } catch (error) {
        return `PARSE-ERR:${error.message.slice(0, 30)}`
      }
    })
    answers[name] = found
    let exact = 0, wrong = 0, missed = 0
    found.forEach((f, i) => {
      if (f === null) missed++
      else if (f === pages[i].gold) exact++
      else wrong++
    })
    console.log(
      `  ${name.padEnd(16)} exact ${String(exact).padStart(3)}  wrong ${String(wrong).padStart(3)}` +
        `  null ${String(missed).padStart(3)}`,
    )
  }

  // The pages linkedom answers and node-html-parser does not.
  for (const variant of ['nhp (default)', 'nhp (+script)']) {
    const lost = []
    pages.forEach((p, i) => {
      if (answers.linkedom[i] !== null && answers[variant][i] !== answers.linkedom[i]) {
        lost.push({ ...p, i })
      }
    })

    console.log(`\n=== ${variant}: ${lost.length} pages diverge from linkedom ===\n`)
    const bySource = {}
    for (const p of lost) {
      const ld = parseHTML(p.html).document
      const nh = VARIANTS[variant](p.html)
      const w = winner(ld, p.url)
      bySource[w.source ?? 'none'] = (bySource[w.source ?? 'none'] ?? 0) + 1

      const a = probe(ld)
      const b = probe(nh)
      const host = new URL(p.url).hostname.replace(/^www\./, '')
      console.log(
        `  ${host.padEnd(28)} linkedom=${String(answers.linkedom[p.i]).padEnd(11)}` +
          ` nhp=${String(answers[variant][p.i]).padEnd(11)} via=${w.source ?? '-'}`,
      )
      console.log(
        `    elements ${String(a.elements).padStart(5)}→${String(b.elements).padStart(5)}` +
          `  meta ${String(a.meta).padStart(3)}→${String(b.meta).padStart(3)}` +
          `  time ${String(a.time).padStart(3)}→${String(b.time).padStart(3)}` +
          `  jsonld ${String(a.jsonld).padStart(2)}→${String(b.jsonld).padStart(2)}` +
          `  ldBytes ${String(a.jsonLdBytes).padStart(6)}→${String(b.jsonLdBytes).padStart(6)}` +
          `  bodyEls ${String(a.body).padStart(5)}→${String(b.body).padStart(5)}`,
      )
    }
    console.log(`\n  winning source on the lost pages (as linkedom saw it):`)
    for (const [source, n] of Object.entries(bySource).sort((x, y) => y[1] - x[1])) {
      console.log(`    ${source.padEnd(24)} ${n}`)
    }
  }

  // End-to-end, because the parse saving is only worth having if it survives
  // the extraction that follows it.
  console.log(`\n=== END TO END, PARSE + EXTRACT ===\n`)
  for (const [name, parse] of Object.entries(VARIANTS)) {
    for (const p of pages.slice(0, 10)) {
      try { answer(parse(p.html), p.url) } catch {}
    }
    let parseMs = 0, totalMs = 0
    for (const p of pages) {
      try {
        let t = performance.now()
        const doc = parse(p.html)
        parseMs += performance.now() - t
        t = performance.now()
        answer(doc, p.url)
        totalMs += parseMs === 0 ? 0 : performance.now() - t
      } catch {}
    }
    const n = pages.length
    console.log(
      `  ${name.padEnd(16)} parse ${(parseMs / n).toFixed(2).padStart(6)} ms` +
        `  extract ${(totalMs / n).toFixed(2).padStart(6)} ms` +
        `  total ${((parseMs + totalMs) / n).toFixed(2).padStart(6)} ms`,
    )
  }
}

await main()
