/**
 * Batch mode — many URLs in, NDJSON out.
 *
 * The shape a crawl actually has. Running the single-URL CLI in a shell loop
 * works and is what people do, and it pays a Node startup per page and fetches
 * one document at a time; on a few thousand URLs that is the difference between
 * minutes and an afternoon. This is the same analysis, pooled.
 *
 * Kept out of `cli.ts` so the interesting parts — the pool, the per-host
 * serialisation, the line parsing — can be tested without spawning a process.
 *
 * Three decisions worth stating, because each is visible in the output:
 *
 * **Results stream as they finish, not in input order.** A pool that preserved
 * order would have to hold every completed result behind the slowest outstanding
 * one, which on a batch containing a single timing-out host means buffering the
 * entire run. Every line carries its `index`, so a caller who wants input order
 * can sort by it — and a caller who is streaming into a database, which is most
 * of them, does not have to wait for it.
 *
 * **One request at a time per host.** The default concurrency applies across the
 * batch, not within a site: eight workers on a batch that happens to be eight
 * pages from one domain is a small denial-of-service, and the polite version
 * costs nothing on a batch that is spread across hosts. `--concurrency` is
 * therefore a ceiling rather than a promise.
 *
 * **A page that fails does not stop the run.** It gets a line with an `error`
 * key and the pool moves on. A batch of 5000 URLs where number 12 is a dead host
 * is a normal batch, not a failed one.
 */

import type { DateResult } from '../types.js'

export type BatchLine =
  | { ok: true; index: number; url: string; extra: Record<string, unknown> }
  | { ok: false; index: number; raw: string; error: string }

/**
 * Read one line of batch input.
 *
 * Two accepted forms, because the two callers are different people. A bare URL
 * per line is what a `cut` or a `find` produces and what someone types. A JSON
 * object with a `url` key is what comes out of the previous stage of a pipeline,
 * and its other keys are carried through to the output so that a join key — a
 * document id, a crawl timestamp — survives the trip. On a key collision
 * pagedate's own output wins, so `url` and `published` always mean what this
 * tool says they mean.
 *
 * Blank lines and `#` comments are skipped so a hand-maintained URL list can be
 * annotated, which is the only reason anyone keeps one in a file.
 */
export function parseBatchLine(raw: string, index: number): BatchLine | null {
  const line = raw.trim()
  if (line === '' || line.startsWith('#')) return null

  if (!line.startsWith('{')) {
    return isHttpUrl(line)
      ? { ok: true, index, url: line, extra: {} }
      : { ok: false, index, raw: line, error: 'not an http(s) URL' }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return { ok: false, index, raw: line, error: 'malformed JSON' }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, index, raw: line, error: 'JSON line is not an object' }
  }

  const { url, ...extra } = parsed as Record<string, unknown>
  if (typeof url !== 'string' || !isHttpUrl(url)) {
    return { ok: false, index, raw: line, error: 'missing or invalid "url"' }
  }

  return { ok: true, index, url, extra }
}

function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

/** Host used for the one-at-a-time rule. Unparseable URLs never reach here. */
const hostOf = (url: string): string => {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/** Lines held back behind a busy host before reading pauses. */
const MAX_DEFERRED = 1024

export type BatchOptions = {
  /** Ceiling on requests in flight across the whole batch. Defaults to 4. */
  concurrency?: number
  /**
   * Analyse one URL. Injected rather than called directly so the pool is
   * testable without network, and so the CLI can pass its own option set
   * through without this module knowing about any of them.
   */
  analyse: (url: string) => Promise<DateResult | null>
  /**
   * Include every candidate, not just the resolved pair. Off by default: on a
   * large batch this is most of the output size, and the resolved pair plus the
   * conflict is what a filtering pipeline reads.
   */
  all?: boolean
}

export type BatchRecord = Record<string, unknown>

/**
 * Run every line through `analyse`, yielding one record per line as it finishes.
 *
 * The pool keeps up to `concurrency` analyses in flight and never two against
 * the same host. When every remaining line belongs to a host already in flight,
 * it waits rather than exceeding the per-host rule — the ceiling is a limit, not
 * a quota to be filled.
 */
export async function* runBatch(
  lines: Iterable<BatchLine> | AsyncIterable<BatchLine>,
  options: BatchOptions,
): AsyncGenerator<BatchRecord> {
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 4, 64))

  const inFlight = new Map<Promise<BatchRecord>, string>()
  const busyHosts = new Set<string>()
  /** Lines held back because their host is busy, oldest first. */
  const deferred: BatchLine[] = []

  const start = (line: BatchLine): void => {
    if (!line.ok) {
      // Nothing to fetch; still needs to be reported, and reported in the same
      // stream so that a caller reading only stdout sees every input accounted
      // for.
      const record = Promise.resolve<BatchRecord>({
        index: line.index,
        url: null,
        error: line.error,
        input: line.raw,
      })
      inFlight.set(record, '')
      return
    }

    const host = hostOf(line.url)
    busyHosts.add(host)
    inFlight.set(analyseOne(line, options), host)
  }

  /** Pull deferred lines that are now runnable, newest host state. */
  const drainDeferred = (): void => {
    for (let i = 0; i < deferred.length && inFlight.size < concurrency; ) {
      const line = deferred[i]!
      if (line.ok && busyHosts.has(hostOf(line.url))) {
        i++
        continue
      }
      deferred.splice(i, 1)
      start(line)
    }
  }

  const settle = async (): Promise<BatchRecord> => {
    /*
     * Race the entries, not the bare promises: the winner has to be identifiable
     * so its slot and its host can be released, and a bare race reports only the
     * value.
     *
     * The `{ promise, record }` wrapper is load-bearing and looks redundant.
     * Resolving each wrapper to its *own promise* — `p.then(() => p)` — reads
     * like the obvious way to recover the handle and does not work: `await`
     * unwraps thenables recursively, so awaiting a promise-of-a-promise yields
     * the record, `inFlight.delete()` is handed a value that is not a key,
     * nothing is ever removed, and the pool yields the first result forever. A
     * plain object is not a thenable, so it survives the await intact.
     */
    const winner = await Promise.race(
      [...inFlight.keys()].map((promise) => promise.then((record) => ({ promise, record }))),
    )
    const host = inFlight.get(winner.promise)
    inFlight.delete(winner.promise)
    if (host) busyHosts.delete(host)
    return winner.record
  }

  for await (const line of lines) {
    // The second condition is what keeps a single-host input from being read
    // into memory whole: every line after the first is deferred, the pool never
    // fills, and without a bound on the queue nothing here ever waits.
    while (inFlight.size >= concurrency || deferred.length >= MAX_DEFERRED) {
      if (inFlight.size > 0) yield await settle()
      drainDeferred()
    }

    if (line.ok && busyHosts.has(hostOf(line.url))) deferred.push(line)
    else start(line)

    drainDeferred()
  }

  while (inFlight.size > 0 || deferred.length > 0) {
    if (inFlight.size === 0) {
      // Everything left is deferred behind a host that is no longer busy, which
      // can only happen if the loop above exited with a full deferred queue.
      drainDeferred()
      continue
    }
    yield await settle()
    drainDeferred()
  }
}

async function analyseOne(
  line: BatchLine & { ok: true },
  options: BatchOptions,
): Promise<BatchRecord> {
  // Caller-supplied keys first: pagedate's own keys overwrite them, so `url` and
  // `published` cannot be shadowed by whatever the pipeline was carrying.
  const base: BatchRecord = { ...line.extra, index: line.index, url: line.url }

  let result: DateResult | null
  try {
    result = await options.analyse(line.url)
  } catch (error) {
    // `findDatesFromUrl` resolves rather than throws for the ordinary failures,
    // so anything landing here is unexpected. It still must not take the batch
    // down with it.
    return { ...base, error: error instanceof Error ? error.message : 'analysis failed' }
  }

  if (!result) return { ...base, error: 'unreachable' }

  return {
    ...base,
    published: result.published ?? null,
    modified: result.modified ?? null,
    conflict: result.conflict ?? null,
    ...(options.all ? { candidates: result.candidates } : {}),
  }
}

/** Split a byte stream into lines, without holding the whole input in memory. */
export async function* readLines(
  stream: AsyncIterable<string | Uint8Array>,
): AsyncGenerator<string> {
  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  for await (const chunk of stream) {
    buffer += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true })

    let newline = buffer.indexOf('\n')
    while (newline !== -1) {
      yield buffer.slice(0, newline)
      buffer = buffer.slice(newline + 1)
      newline = buffer.indexOf('\n')
    }
  }

  // A final line with no trailing newline is still a line.
  if (buffer !== '') yield buffer
}
