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

  for (const [name, run] of Object.entries(tools)) {
    for (const [url, entry] of Object.entries(index)) {
      if (!cached.has(entry.file)) continue
      const html = await readFile(join(CACHE, entry.file), 'utf8')

      const started = performance.now()
      let found = null
      try {
        found = await run(html, url)
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
