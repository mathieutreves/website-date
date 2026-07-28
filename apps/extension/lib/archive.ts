/**
 * Internet Archive lookup — the evidence a page cannot suppress.
 *
 * `stale-declaration` is the one conflict the library can detect but the page
 * itself will never admit to: a post declaring 2019, silently rewritten since,
 * with no modification date anywhere in its markup. The only witness is an
 * outside record of what the page used to say.
 *
 * This is off by default and behind its own permission, because asking
 * web.archive.org about a page tells them which page you are reading. That is a
 * real cost, and it is stated in the setting rather than buried here.
 */

const CDX = 'https://web.archive.org/cdx/search/cdx'

/** Enough captures to find the last content change without a slow response. */
const ROW_LIMIT = 300

export type ArchiveLookup = {
  /** ISO instant of the most recent capture whose content differed. */
  lastEdit?: string
  firstCapture?: string
  /** True when the row limit was hit, so the history is incomplete. */
  truncated: boolean
}

/** CDX timestamps are `YYYYMMDDhhmmss` in UTC. */
export function parseCdxTimestamp(stamp: string): string | null {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(stamp)
  if (!match) return null
  const [, y, mo, d, h, mi, s] = match
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${s}Z`
  return Number.isNaN(new Date(iso).getTime()) ? null : iso
}

/**
 * Rows come back oldest-first. `collapse=digest` drops runs of captures whose
 * content hash matched the one before, so every remaining row after the first
 * is a capture where the page had actually changed.
 */
export function readCdx(rows: unknown): ArchiveLookup | null {
  if (!Array.isArray(rows) || rows.length < 2) return null

  const stamps = rows
    .slice(1)
    .map((row) => (Array.isArray(row) && typeof row[0] === 'string' ? parseCdxTimestamp(row[0]) : null))
    .filter((value): value is string => value !== null)

  if (stamps.length === 0) return null

  const first = stamps[0]
  // The first row is the page appearing, not changing. With only one capture
  // there is no edit to report.
  const last = stamps.length > 1 ? stamps[stamps.length - 1] : undefined

  return {
    truncated: rows.length - 1 >= ROW_LIMIT,
    ...(first ? { firstCapture: first } : {}),
    ...(last ? { lastEdit: last } : {}),
  }
}

export async function fetchArchive(pageUrl: string): Promise<ArchiveLookup | null> {
  const query = new URLSearchParams({
    url: pageUrl,
    output: 'json',
    fl: 'timestamp,digest',
    collapse: 'digest',
    limit: String(ROW_LIMIT),
  })

  try {
    const response = await fetch(`${CDX}?${query}`, { credentials: 'omit' })
    if (!response.ok) return null
    return readCdx(await response.json())
  } catch {
    // Offline, rate-limited, or the permission was revoked mid-flight. The
    // page's own dates are still shown; only the extra check is missing.
    return null
  }
}
