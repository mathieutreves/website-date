import { describe, expect, it } from 'vitest'
import { parseBatchLine, readLines, runBatch, type BatchLine } from '../src/node/batch.js'
import type { Candidate, DateResult } from '../src/types.js'

const published = (value: string): Candidate => ({
  value,
  precision: 'day',
  field: 'published',
  source: 'jsonld',
  confidence: 'declared',
})

const dated = (value: string): DateResult => ({ candidates: [], published: published(value) })

const lines = (...urls: string[]): BatchLine[] =>
  urls.map((url, index) => ({ ok: true, index, url, extra: {} }))

const collect = async (gen: AsyncIterable<unknown>): Promise<unknown[]> => {
  const out: unknown[] = []
  for await (const item of gen) out.push(item)
  return out
}

describe('parseBatchLine', () => {
  it('reads a bare URL', () => {
    expect(parseBatchLine('https://example.com/a', 0)).toEqual({
      ok: true,
      index: 0,
      url: 'https://example.com/a',
      extra: {},
    })
  })

  it('skips blank lines and comments', () => {
    expect(parseBatchLine('', 0)).toBeNull()
    expect(parseBatchLine('   ', 0)).toBeNull()
    expect(parseBatchLine('# a note', 0)).toBeNull()
  })

  it('reads a JSON object and keeps its other keys', () => {
    expect(parseBatchLine('{"url":"https://example.com/a","docId":7}', 3)).toEqual({
      ok: true,
      index: 3,
      url: 'https://example.com/a',
      extra: { docId: 7 },
    })
  })

  it('rejects a non-URL, malformed JSON, and a JSON array', () => {
    expect(parseBatchLine('not a url', 0)).toMatchObject({ ok: false, error: 'not an http(s) URL' })
    expect(parseBatchLine('{oops', 0)).toMatchObject({ ok: false, error: 'malformed JSON' })
    expect(parseBatchLine('{"url":"ftp://example.com"}', 0)).toMatchObject({ ok: false })
    expect(parseBatchLine('{"nourl":1}', 0)).toMatchObject({ ok: false })
  })

  /* A JSON *array* line starts with `[`, so it is treated as a bare URL and
   * rejected as one — the same outcome by a different route. Asserted because
   * the `startsWith('{')` dispatch is what makes that true. */
  it('rejects a JSON array line', () => {
    expect(parseBatchLine('["https://example.com/a"]', 0)).toMatchObject({ ok: false })
  })
})

describe('readLines', () => {
  async function* chunks(...parts: string[]) {
    for (const part of parts) yield part
  }

  it('splits across chunk boundaries', async () => {
    expect(await collect(readLines(chunks('a\nb', 'c\nd\n')))).toEqual(['a', 'bc', 'd'])
  })

  it('yields a trailing line with no newline', async () => {
    expect(await collect(readLines(chunks('only')))).toEqual(['only'])
  })

  it('decodes bytes', async () => {
    async function* bytes() {
      yield new TextEncoder().encode('héllo\n')
    }
    expect(await collect(readLines(bytes()))).toEqual(['héllo'])
  })
})

describe('runBatch', () => {
  it('analyses every line and reports the resolved pair', async () => {
    const records = (await collect(
      runBatch(lines('https://a.example/1', 'https://b.example/2'), {
        analyse: async () => dated('2024-03-12'),
      }),
    )) as Record<string, unknown>[]

    expect(records).toHaveLength(2)
    expect(records.map((r) => r.url).sort()).toEqual([
      'https://a.example/1',
      'https://b.example/2',
    ])
    expect(records[0]).toMatchObject({ published: { value: '2024-03-12' }, modified: null })
  })

  it('carries caller keys through, and lets pagedate win a collision', async () => {
    const records = (await collect(
      runBatch(
        [{ ok: true, index: 0, url: 'https://a.example/1', extra: { docId: 7, published: 'mine' } }],
        { analyse: async () => dated('2024-03-12') },
      ),
    )) as Record<string, unknown>[]

    expect(records[0]!.docId).toBe(7)
    expect(records[0]!.published).toMatchObject({ value: '2024-03-12' })
  })

  it('reports a failed page and keeps going', async () => {
    const records = (await collect(
      runBatch(lines('https://a.example/1', 'https://b.example/2', 'https://c.example/3'), {
        analyse: async (url) => (url.includes('b.example') ? null : dated('2024-03-12')),
      }),
    )) as Record<string, unknown>[]

    expect(records).toHaveLength(3)
    expect(records.find((r) => String(r.url).includes('b.example'))).toMatchObject({
      error: 'unreachable',
    })
  })

  it('survives an analyse that throws', async () => {
    const records = (await collect(
      runBatch(lines('https://a.example/1', 'https://b.example/2'), {
        analyse: async (url) => {
          if (url.includes('a.example')) throw new Error('boom')
          return dated('2024-03-12')
        },
      }),
    )) as Record<string, unknown>[]

    expect(records).toHaveLength(2)
    expect(records.find((r) => r.error)).toMatchObject({ error: 'boom' })
  })

  it('emits a record for an unparseable line too, so nothing is silently dropped', async () => {
    const input: BatchLine[] = [
      { ok: false, index: 0, raw: 'nonsense', error: 'not an http(s) URL' },
      { ok: true, index: 1, url: 'https://a.example/1', extra: {} },
    ]

    const records = (await collect(
      runBatch(input, { analyse: async () => dated('2024-03-12') }),
    )) as Record<string, unknown>[]

    expect(records).toHaveLength(2)
    expect(records.find((r) => r.url === null)).toMatchObject({
      error: 'not an http(s) URL',
      input: 'nonsense',
    })
  })

  it('includes candidates only when asked', async () => {
    const withCandidates: DateResult = {
      candidates: [published('2024-03-12')],
      published: published('2024-03-12'),
    }

    const lean = (await collect(
      runBatch(lines('https://a.example/1'), { analyse: async () => withCandidates }),
    )) as Record<string, unknown>[]
    expect(lean[0]).not.toHaveProperty('candidates')

    const full = (await collect(
      runBatch(lines('https://a.example/1'), { analyse: async () => withCandidates, all: true }),
    )) as Record<string, unknown>[]
    expect(full[0]!.candidates).toHaveLength(1)
  })

  describe('the pool', () => {
    /** Records peak concurrency and per-host overlap while resolving on demand. */
    function tracker() {
      let inFlight = 0
      let peak = 0
      const hostsInFlight = new Set<string>()
      let hostOverlap = false
      const release: (() => void)[] = []

      const analyse = async (url: string): Promise<DateResult> => {
        const host = new URL(url).host
        if (hostsInFlight.has(host)) hostOverlap = true
        hostsInFlight.add(host)
        inFlight++
        peak = Math.max(peak, inFlight)

        await new Promise<void>((resolve) => release.push(resolve))

        inFlight--
        hostsInFlight.delete(host)
        return dated('2024-03-12')
      }

      return {
        analyse,
        peak: () => peak,
        hostOverlap: () => hostOverlap,
        /** Let everything currently waiting finish. */
        flush: () => {
          while (release.length > 0) release.shift()!()
        },
      }
    }

    it('never exceeds the concurrency ceiling', async () => {
      const track = tracker()
      const urls = Array.from({ length: 12 }, (_, i) => `https://host${i}.example/p`)

      const run = collect(runBatch(lines(...urls), { analyse: track.analyse, concurrency: 3 }))

      // Let the pool fill and drain repeatedly; each tick releases whatever is
      // waiting, and the pool refills behind it.
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setImmediate(r))
        track.flush()
      }

      const records = await run
      expect(records).toHaveLength(12)
      expect(track.peak()).toBeLessThanOrEqual(3)
    })

    it('never runs two requests against the same host at once', async () => {
      const track = tracker()
      // Eight pages, one host, eight permitted workers: the per-host rule is the
      // only thing stopping all eight going at once.
      const urls = Array.from({ length: 8 }, (_, i) => `https://one.example/p${i}`)

      const run = collect(runBatch(lines(...urls), { analyse: track.analyse, concurrency: 8 }))

      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setImmediate(r))
        track.flush()
      }

      const records = await run
      expect(records).toHaveLength(8)
      expect(track.hostOverlap()).toBe(false)
      expect(track.peak()).toBe(1)
    })

    it('interleaves hosts rather than stalling behind a busy one', async () => {
      const track = tracker()
      // Same host twice, then a different one. A pool that simply blocked on the
      // busy host would run these one at a time; the deferral queue should let
      // the third overlap with the first.
      const run = collect(
        runBatch(
          lines('https://one.example/a', 'https://one.example/b', 'https://two.example/c'),
          { analyse: track.analyse, concurrency: 4 },
        ),
      )

      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setImmediate(r))
        track.flush()
      }

      expect(await run).toHaveLength(3)
      expect(track.peak()).toBe(2)
      expect(track.hostOverlap()).toBe(false)
    })
  })
})
