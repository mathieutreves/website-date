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
import { createRequire } from 'node:module'
import type { Candidate, Confidence, DateResult, Mode } from '../types.js'
import { parseBatchLine, readLines, runBatch } from './batch.js'
import { findDatesFromHtml, findDatesFromUrl, MissingParserError, nodeEnv } from './index.js'

const HELP = `pagedate — find when a web page was published and last modified

USAGE
  pagedate <url>                 fetch and analyse a live page
  pagedate --file <path> --url <url>   analyse a saved page
  cat page.html | pagedate --url <url> analyse stdin; --url names the page,
                                       and nothing is fetched
  pagedate --batch < urls.txt    analyse many URLs, NDJSON out

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
  -V, --version print the version

BATCH
  --batch       read URLs from stdin, one per line, and write one JSON object
                per line to stdout. Lines may instead be JSON objects with a
                "url" key, whose other keys are carried through to the output.
                Blank lines and # comments are skipped.
  --concurrency N   pages in flight at once (default 4, max 64). Never more
                than one request per host regardless, so this is a ceiling.

  Results stream as they complete, NOT in input order; every record carries
  its input line "index" for callers who need to restore it. A page that fails
  gets a record with an "error" key and does not stop the run.

EXIT CODES
  0  a date was found      1  no date found      2  the page could not be read,
                                                    or the arguments were wrong

  In batch mode: 0 if any page yielded a date, 1 if none did, 2 if stdin
  could not be read at all.
`

type Options = {
  url?: string
  /** The URL was given bare, which means "fetch this" and never "read stdin". */
  positional: boolean
  file?: string
  json: boolean
  all: boolean
  offline: boolean
  sitemap: boolean
  httpHeaders: boolean
  mode?: Mode
  minConfidence?: Confidence
  batch: boolean
  concurrency?: number
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    positional: false,
    json: false,
    all: false,
    offline: false,
    sitemap: true,
    httpHeaders: false,
    batch: false,
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === '--json') options.json = true
    else if (arg === '--all') options.all = true
    else if (arg === '--offline') options.offline = true
    else if (arg === '--no-sitemap') options.sitemap = false
    else if (arg === '--headers') options.httpHeaders = true
    else if (arg === '--declared') options.minConfidence = 'declared'
    else if (arg === '--batch') options.batch = true
    else if (arg === '--concurrency') {
      const value = Number(argv[++i])
      if (!Number.isInteger(value) || value < 1 || value > 64) {
        process.stderr.write('--concurrency must be an integer between 1 and 64\n')
        process.exit(2)
      }
      options.concurrency = value
    }
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
    }
    else if (arg === '-V' || arg === '--version') {
      const { version } = createRequire(import.meta.url)('../../package.json') as { version: string }
      process.stdout.write(`${version}\n`)
      process.exit(0)
    }
    // Refused rather than skipped: a mistyped `--no-sitmap` that is silently
    // dropped leaves the lookup on, and the run looks like it did what was asked.
    else if (arg.startsWith('-')) usage(`unknown option ${arg}`)
    else if (options.url) usage(`unexpected argument ${arg}: one URL at a time, or use --batch`)
    else {
      options.url = arg
      options.positional = true
    }
  }

  if (options.url !== undefined && !isWebUrl(options.url)) {
    usage(`not an http(s) URL: ${options.url}`)
  }

  return options
}

function usage(message: string): never {
  process.stderr.write(`${message}\nTry pagedate --help\n`)
  process.exit(2)
}

function isWebUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Write the last of the output, then exit.
 *
 * `process.exit()` straight after `process.stdout.write()` drops whatever the
 * pipe had not yet accepted: stdout is asynchronous when it is a pipe, and a
 * `--json --all` result larger than the pipe buffer arrived downstream cut off
 * at 64 kB. Exiting from the write callback waits for the flush.
 */
function finish(text: string, code: number): Promise<never> {
  return new Promise<never>(() => {
    process.stdout.write(text, () => process.exit(code))
  })
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

/**
 * Batch mode: stdin to stdout, streaming both ways.
 *
 * Written back with `process.stdout.write` per record rather than collected and
 * joined, so a long batch is usable while it runs and a consumer downstream of a
 * pipe sees progress. Backpressure is deliberately ignored: `write` returning
 * false only matters when producing faster than the consumer drains, and every
 * record here is gated behind a network fetch.
 */
async function runBatchMode(options: Options): Promise<never> {
  if (process.stdin.isTTY) {
    process.stderr.write('--batch reads URLs from stdin; none was piped in\n')
    process.exit(2)
  }

  const analysisOpts = analysisOptions(options)
  const analyse = (url: string): Promise<DateResult | null> =>
    options.offline
      ? nodeEnv()
          .fetchText?.(url)
          .then((html) => (html ? findDatesFromHtml(html, url, analysisOpts) : null)) ??
        Promise.resolve(null)
      : findDatesFromUrl(url, analysisOpts)

  async function* lines() {
    let index = 0
    for await (const raw of readLines(process.stdin)) {
      const parsed = parseBatchLine(raw, index++)
      if (parsed) yield parsed
    }
  }

  let found = 0
  let total = 0

  const batchOptions = {
    analyse,
    ...(options.concurrency !== undefined ? { concurrency: options.concurrency } : {}),
    ...(options.all ? { all: true } : {}),
  }

  for await (const record of runBatch(lines(), batchOptions)) {
    total++
    if (record.published || record.modified) found++
    process.stdout.write(`${JSON.stringify(record)}\n`)
  }

  // An empty stdin is not an error — a pipeline stage upstream is entitled to
  // produce nothing — but it did not find a date either.
  return finish('', total > 0 && found > 0 ? 0 : 1)
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))

  if (options.batch) await runBatchMode(options)

  let result: DateResult | null = null

  // Stdin is read only when nothing else says where the page is. A bare URL
  // always means "fetch": inside `while read url; do pagedate "$url"; done`, or
  // under any parent that leaves a pipe open, stdin is not a TTY and is not a
  // page either, and reading it swallows the rest of the loop's input.
  const stdin = options.file || options.positional ? null : await readStdin()
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

  const output = options.json ? JSON.stringify(result, null, 2) : render(result, options)
  await finish(`${output}\n`, result.published || result.modified ? 0 : 1)
}

// `pagedate --batch | head -1` closes the pipe while records are still being
// written. That is the consumer saying it has enough, not a failure.
process.stdout.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EPIPE') process.exit(0)
  throw error
})

try {
  await main()
} catch (error) {
  // The HTML parser is an optional peer dependency, so `npx pagedate` on a
  // machine that has never installed it is the ordinary first run.
  if (!(error instanceof MissingParserError)) throw error
  process.stderr.write(
    `${error.message}\nOr, without installing: npx -p pagedate -p node-html-parser -p linkedom pagedate <url>\n`,
  )
  process.exit(2)
}
