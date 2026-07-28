import { toInstant, type Candidate, type DateResult } from 'pagedate'

/**
 * Pure view layer — no browser APIs, so it can be tested directly.
 *
 * Kept separate from main.ts because this is where the bugs that matter live:
 * HTML escaping, and formatting a date to exactly the precision its source
 * carried and no further.
 */

/** innerHTML builds the layout; every interpolated value passes through here. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export const tierWord = (confidence: Candidate['confidence']): string =>
  ({
    declared: 'stated by the site',
    derived: 'from page markup',
    inferred: 'inferred',
  })[confidence]

/**
 * Format to the precision the source actually carried.
 *
 * A year-precision candidate renders as "2024", never as "1 January 2024" —
 * inventing a day the page never stated is the same dishonesty the library
 * refuses at the parse layer.
 */
export function display(candidate: Candidate): string {
  const value = candidate.value

  if (candidate.precision === 'year') return value

  if (candidate.precision === 'month') {
    const date = new Date(`${value}-01T00:00:00Z`)
    if (Number.isNaN(date.getTime())) return value
    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', timeZone: 'UTC' })
  }

  if (candidate.precision === 'day') {
    const date = new Date(`${value}T00:00:00Z`)
    if (Number.isNaN(date.getTime())) return value
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'UTC',
    })
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
}

export const originOf = (url: string): string | null => {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

/**
 * Confidence is rendered as a distinct visual treatment, not just a word.
 *
 * Showing "declared by the site" and "guessed from body text" identically is
 * the failure mode of every existing extension of this kind: the number looks
 * equally authoritative either way, which is the problem being solved.
 */
export function dateRow(label: string, candidate: Candidate | undefined): string {
  if (!candidate) {
    return `
      <div class="row absent">
        <div class="label">${escapeHtml(label)}</div>
        <div class="value">—</div>
      </div>`
  }

  return `
    <div class="row tier-${candidate.confidence}">
      <div class="label">${escapeHtml(label)}</div>
      <div class="value">
        <time datetime="${escapeHtml(candidate.value)}">${escapeHtml(display(candidate))}</time>
      </div>
      <div class="provenance">
        <span class="tier">${escapeHtml(tierWord(candidate.confidence))}</span>
        <span class="source">${escapeHtml(candidate.source)}</span>
      </div>
      ${candidate.note ? `<div class="note">${escapeHtml(candidate.note)}</div>` : ''}
    </div>`
}

export function conflictBlock(result: DateResult): string {
  const conflict = result.conflict
  if (!conflict) return ''

  const heading = {
    'declared-disagreement': 'This page contradicts itself',
    'predated-content': 'This page is probably older than it says',
    'stale-declaration': 'This page may have changed since it says',
  }[conflict.kind]

  return `
    <div class="conflict">
      <div class="conflict-heading">${escapeHtml(heading)}</div>
      <div class="conflict-detail">${escapeHtml(conflict.detail)}</div>
    </div>`
}

/**
 * Oldest first.
 *
 * Extraction order is an implementation detail and reads as arbitrary. Sorting
 * chronologically makes the spread of dates legible at a glance, and puts the
 * oldest evidence at the top — which is exactly what matters on a page
 * declaring a recent date while carrying much older content.
 */
function byDateAscending(a: Candidate, b: Candidate): number {
  const ta = toInstant(a.value)?.getTime() ?? Number.POSITIVE_INFINITY
  const tb = toInstant(b.value)?.getTime() ?? Number.POSITIVE_INFINITY
  return ta - tb
}

function candidateList(candidates: Candidate[]): string {
  const rows = [...candidates]
    .sort(byDateAscending)
    .map(
      (c) => `
        <li class="tier-${c.confidence}">
          <span class="c-value">${escapeHtml(display(c))}</span>
          <span class="c-field">${escapeHtml(c.field)}</span>
          <span class="c-source">${escapeHtml(c.source)}</span>
        </li>`,
    )
    .join('')

  return `
    <details>
      <summary>${candidates.length} other candidate${candidates.length === 1 ? '' : 's'}</summary>
      <ul class="candidates">${rows}</ul>
    </details>`
}

export function view(result: DateResult, url: string, fromCache: boolean): string {
  const parts: string[] = []

  if (result.conflict) parts.push(conflictBlock(result))

  parts.push(dateRow('Published', result.published))
  parts.push(dateRow('Last modified', result.modified))

  if (!result.published && !result.modified) {
    parts.push(`
      <p class="empty">
        No date found. That is sometimes the correct answer — this page may
        genuinely not state when it was written.
      </p>`)
  }

  const others = result.candidates.filter((c) => c !== result.published && c !== result.modified)
  if (others.length > 0) parts.push(candidateList(others))

  const host = originOf(url)?.replace(/^https?:\/\//, '') ?? ''
  parts.push(`
    <footer>
      <span class="host">${escapeHtml(host)}</span>
      ${fromCache ? '<button id="refresh" type="button">Refresh</button>' : ''}
    </footer>`)

  return parts.join('')
}

export const unsupportedView = (): string =>
  `<p class="empty">Open a web page to check when it was written.</p>`

export const errorView = (message: string): string =>
  `<p class="empty error">${escapeHtml(message)}</p>`
