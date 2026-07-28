import type { Candidate } from '../types.js'
import { parseDateString, toInstant } from '../parse/normalize.js'

/**
 * The `Last-Modified` response header.
 *
 * Off by default, and the reason is measurement rather than taste. On a static
 * host this is the file's mtime and is real information; behind a CDN or any
 * dynamic renderer it is the moment the response was assembled. On our own
 * fixtures it was right once by coincidence, wrong twice — it invented a
 * modification date for a hand-written page that has none, and reported a
 * GitHub Pages rebuild as an edit to a release announcement.
 *
 * So it exists, it is labelled `inferred`, it ranks below every other signal,
 * and the caller has to ask for it. See docs/DESIGN.md §4.10.
 */

/**
 * How close to the response's own `Date` a `Last-Modified` may be before it is
 * read as a serve timestamp rather than a fact about the content.
 *
 * Generous on purpose: a page assembled per request typically stamps the two
 * within a second of each other, and nothing that regenerates minutes before
 * you asked for it is telling you when it was *written*.
 */
const SERVE_TIME_WINDOW_MS = 5 * 60 * 1000

/**
 * Headers that mean the response was assembled for this request.
 *
 * A page that refuses to be cached, or that sets a cookie while serving itself,
 * is being generated per visitor — whatever its `Last-Modified` says, it is not
 * describing a file that sat on a disk since someone wrote it.
 */
const NO_CACHE = /\b(?:no-store|no-cache|max-age=0)\b/i

/**
 * Read the transport's opinion of when the page last changed.
 *
 * `now` is the fallback reference when the server sent no `Date` header, and is
 * injectable so the check is deterministic under test.
 */
export function extractHttpHeaders(
  headers: Record<string, string>,
  now: Date = new Date(),
): Candidate[] {
  const lookup = lowercased(headers)

  const raw = lookup['last-modified']
  if (!raw) return []

  if (lookup['set-cookie'] !== undefined) return []
  if (lookup['cache-control'] && NO_CACHE.test(lookup['cache-control'])) return []

  const parsed = parseDateString(raw)
  if (!parsed) return []

  const at = toInstant(parsed.value)
  if (!at) return []

  // The response's own Date is the better reference: it tells us when *this*
  // copy was produced, where `now` also includes however long the fetch took
  // and whatever clock skew sits between us and the server.
  const servedAtHeader = lookup['date'] ? parseDateString(lookup['date']) : null
  const servedAt = (servedAtHeader && toInstant(servedAtHeader.value)) ?? now

  if (Math.abs(at.getTime() - servedAt.getTime()) < SERVE_TIME_WINDOW_MS) return []

  return [
    {
      ...parsed,
      field: 'modified',
      source: 'http-last-modified',
      confidence: 'inferred',
      note: 'Last-Modified response header',
    },
  ]
}

/**
 * Header names are case-insensitive and the two callers disagree: `fetch`
 * lowercases them, a hand-rolled shim may not.
 */
function lowercased(headers: Record<string, string>): Record<string, string> {
  // Null-prototype: the keys are header names off the wire, so the server picks
  // them. `Object.prototype` currently has nothing that collides with the four
  // names read below, and V8's `__proto__` setter ignores string values — but
  // that is a fact about today's reads and today's engine, not a property of
  // this function.
  const out: Record<string, string> = Object.create(null)
  for (const [key, value] of Object.entries(headers)) out[key.toLowerCase()] = value
  return out
}
