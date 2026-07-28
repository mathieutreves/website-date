#!/usr/bin/env node
/**
 * pagedate CLI.
 *
 *   npx pagedate https://example.com/post
 *   npx pagedate --json https://example.com/post
 *   cat page.html | npx pagedate --url https://example.com/post
 *
 * Prints the resolved dates with their provenance, because a date without a
 * source is exactly the thing this project exists to complain about.
 */

import { readFile } from 'node:fs/promises'
import type { Candidate, Confidence, DateResult, Mode } from '../types.js'
import { findDatesFromHtml, findDatesFromUrl, nodeEnv } from './index.js'

const HELP = `pagedate — find when a web page was published and last modified

USAGE
  pagedate <url>                 fetch and analyse a live page
  pagedate --file <path> --url <url>   analyse a saved page
  cat page.html | pagedate --url <url> analyse stdin

OPTIONS
  --json        machine-readable output
  --all         list every candidate, not just the resolved pair
  --offline     skip network signals (feed, sitemap) when analysing a URL
  --mode M      fast | standard (default) | extensive
                fast reads declared metadata only and is ~4x quicker
  --declared    only report dates the site states itself, never inference
  --no-sitemap  skip the sitemap <lastmod> lookup
  --headers     also read Last-Modified from the response headers; off by
                default because behind a CDN it reports the serve time
  -h, --help    show this

EXIT CODES
  0  a date was found      1  no date found      2  the page could not be read
`

type Options = {
  url?: string
  file?: string
  json: boolean
  all: boolean
  offline: boolean
  sitemap: boolean
  httpHeaders: boolean
  mode?: Mode
  minConfidence?: Confidence
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    json: false,
    all: false,
    offline: false,
    sitemap: true,
    httpHeaders: false,
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === '--json') options.json = true
    else if (arg === '--all') options.all = true
    else if (arg === '--offline') options.offline = true
    else if (arg === '--no-sitemap') options.sitemap = false
    else if (arg === '--headers') options.httpHeaders = true
    else if (arg === '--declared') options.minConfidence = 'declared'
    else if (arg === '--mode') {
      const value = argv[++i]
      if (value !== 'fast' && value !== 'standard' && value !== 'extensive') {
        process.stderr.write('--mode must be fast, standard or extensive\n')
        process.exit(2)
      }
      options.mode = value
    }
    else if (arg === '--url' || arg === '--file') {
      const value = argv[++i]
      // A trailing `--url` with nothing after it is a typo, not an empty value.
      if (value === undefined || value.startsWith('-')) {
        process.stderr.write(`${arg} needs a value\n`)
        process.exit(2)
      }
      if (arg === '--url') options.url = value
      else options.file = value
    }
    else if (arg === '-h' || arg === '--help') {
      process.stdout.write(HELP)
      process.exit(0)
    } else if (!arg.startsWith('-') && !options.url) options.url = arg
  }

  return options
}

async function readStdin(): Promise<string | null> {
  if (process.stdin.isTTY) return null
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  const text = Buffer.concat(chunks).toString('utf8')
  return text.trim() ? text : null
}

const label = (c: Candidate): string => `${c.value}  [${c.confidence} · ${c.source}]`

function render(result: DateResult, options: Options): string {
  const lines: string[] = []

  lines.push(`published  ${result.published ? label(result.published) : '—'}`)
  lines.push(`modified   ${result.modified ? label(result.modified) : '—'}`)

  if (result.conflict) {
    lines.push('')
    lines.push(`conflict   ${result.conflict.kind} (${result.conflict.gapDays} days)`)
    lines.push(`           ${result.conflict.detail}`)
  }

  if (options.all && result.candidates.length > 0) {
    lines.push('')
    lines.push(`candidates (${result.candidates.length})`)
    for (const c of result.candidates) {
      lines.push(`  ${c.field.padEnd(9)} ${label(c)}${c.note ? `\n            ${c.note}` : ''}`)
    }
  }

  return lines.join('\n')
}

type AnalysisOptions = {
  mode?: Mode
  minConfidence?: Confidence
  sitemap?: boolean
  httpHeaders?: boolean
}

/** Only set keys the user actually supplied — exactOptionalPropertyTypes. */
function analysisOptions(options: Options): AnalysisOptions {
  const out: AnalysisOptions = {}
  if (options.mode) out.mode = options.mode
  if (options.minConfidence) out.minConfidence = options.minConfidence
  if (!options.sitemap) out.sitemap = false
  if (options.httpHeaders) out.httpHeaders = true
  return out
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))

  let result: DateResult | null = null

  const stdin = options.file ? null : await readStdin()
  const html = options.file ? await readFile(options.file, 'utf8').catch(() => null) : stdin

  if (html !== null) {
    if (!options.url) {
      process.stderr.write('--url is required when reading HTML from a file or stdin\n')
      process.exit(2)
    }
    // URL-derived signals still work offline; only the feed needs network.
    result = await findDatesFromHtml(html, options.url, analysisOptions(options))
  } else if (options.file) {
    process.stderr.write(`could not read ${options.file}\n`)
    process.exit(2)
  } else if (options.url) {
    if (options.offline) {
      // The page itself still has to be fetched; --offline suppresses the
      // *extra* lookups (feed, sitemap) rather than all network access.
      const page = await nodeEnv().fetchText?.(options.url)
      if (!page) {
        process.stderr.write(`could not fetch ${options.url}\n`)
        process.exit(2)
      }
      result = await findDatesFromHtml(page, options.url, analysisOptions(options))
    } else {
      result = await findDatesFromUrl(options.url, analysisOptions(options))
    }
    if (!result) {
      process.stderr.write(`could not fetch ${options.url}\n`)
      process.exit(2)
    }
  } else {
    process.stdout.write(HELP)
    process.exit(0)
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } else {
    process.stdout.write(`${render(result, options)}\n`)
  }

  process.exit(result.published || result.modified ? 0 : 1)
}

await main()
