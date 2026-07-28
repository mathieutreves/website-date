/**
 * Run the JS alternatives over the same cached corpus.
 *
 * This is the comparison that decides positioning: pagedate is a JavaScript
 * library, so the relevant question is not only how it compares to a mature
 * Python tool, but whether anything in its own ecosystem does the job.
 *
 * Kept in bench/ with its own node_modules so competitor packages never enter
 * the published dependency tree.
 *
 *   node bench/bench_js.mjs > /tmp/bench-js.jsonl
 */

import { readFile, readdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const HERE = dirname(fileURLToPath(import.meta.url))
const CORPUS = join(HERE, '..', 'corpus-external', 'htmldate')
const CACHE = join(CORPUS, 'cache')

const norm = (value) => {
  if (!value) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10)
  const text = String(value).trim()
  const iso = /(\d{4}-\d{2}-\d{2})/.exec(text)
  return iso ? iso[1] : null
}

async function buildTools() {
  const tools = {}

  // metascraper is the incumbent in JavaScript, so this is the comparison that
  // decides positioning far more than any Python tool does.
  //
  // Measured twice, because one number alone misleads:
  //  - "with parse" is what a caller actually pays, cheerio included
  //  - "rules only" is what the date heuristics cost, with parsing hoisted out
  //
  // The two sides cannot share a parsed document — metascraper's `htmlDom` must
  // be a cheerio instance and pagedate reads a DOM — so "rules only" is the
  // closest honest equivalent to pagedate's own parse-excluded figure.
  try {
    const metascraper = (await import('metascraper')).default
    const metascraperDate = (await import('metascraper-date')).default

    // Resolved through metascraper's own require, not ours: `htmlDom` has to be
    // built by the exact cheerio it will use, and a second copy at a different
    // version would either throw or quietly behave differently.
    const require = createRequire(import.meta.resolve('metascraper'))
    const cheerio = require('cheerio')
    const load = cheerio.load ?? cheerio.default?.load

    // Loading only the date bundle is already the restriction; pickPropNames is
    // belt-and-braces in case a rule bundle ever pulls in siblings.
    const scrape = metascraper([metascraperDate()])
    const pick = new Set(['date'])

    tools['metascraper (with parse)'] = async (html, url) =>
      (await scrape({ html, url, pickPropNames: pick, validateUrl: false })).date

    tools['metascraper (rules only)'] = {
      // Parsing happens here, outside the timed region.
      prepare: (html, url) => load(html, { baseURI: url }),
      run: async (html, url, htmlDom) =>
        (await scrape({ htmlDom, url, pickPropNames: pick, validateUrl: false })).date,
    }
  } catch (error) {
    console.error('skip metascraper:', error.message)
  }

  try {
    const { extractFromHtml } = await import('@extractus/article-extractor')
    tools['@extractus/article-extractor'] = async (html, url) => {
      const article = await extractFromHtml(html, url)
      return article?.published ?? null
    }
  } catch (error) {
    console.error('skip @extractus:', error.message)
  }

  try {
    const unfluffModule = await import('unfluff')
    const unfluff = unfluffModule.default ?? unfluffModule
    tools['unfluff'] = async (html) => unfluff(html)?.date ?? null
  } catch (error) {
    console.error('skip unfluff:', error.message)
  }

  return tools
}

async function main() {
  const index = JSON.parse(await readFile(join(CORPUS, 'eval_default.json'), 'utf8'))
  const cached = new Set(await readdir(CACHE))
  const tools = await buildTools()
  console.error('tools:', Object.keys(tools).join(', '))

  for (const [name, tool] of Object.entries(tools)) {
    // A tool may hoist setup it does not want measured — see metascraper above.
    const run = typeof tool === 'function' ? tool : tool.run
    const prepare = typeof tool === 'function' ? null : tool.prepare

    for (const [url, entry] of Object.entries(index)) {
      if (!cached.has(entry.file)) continue
      const html = await readFile(join(CACHE, entry.file), 'utf8')
      const prepared = prepare ? prepare(html, url) : undefined

      const started = performance.now()
      let found = null
      try {
        found = await run(html, url, prepared)
      } catch {
        found = null
      }
      const ms = performance.now() - started

      process.stdout.write(
        `${JSON.stringify({
          tool: name,
          file: entry.file,
          gold: entry.date,
          found: norm(found),
          ms: Math.round(ms * 100) / 100,
        })}\n`,
      )
    }
  }
}

await main()
