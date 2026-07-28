import { toInstant, type Candidate, type DateResult } from 'pagedate'
import { t, type MessageKey } from '../../lib/messages.js'
import { display, fieldLabel, relativeAge, sourceLabel, tierWord } from '../../lib/format.js'
import { computeSpread, isSpreadWorthShowing, type Spread } from '../../lib/spread.js'
import type { ArchiveMode, DateFormat } from '../../lib/settings.js'

/**
 * Pure view layer — no browser APIs, so it can be tested directly.
 *
 * Kept separate from main.ts because this is where the bugs that matter live:
 * HTML escaping, and formatting a date to exactly the precision its source
 * carried and no further.
 *
 * The design rules this file encodes, in priority order:
 *
 *   1. Answer the question that was asked. Someone clicks this to find out
 *      whether a page is current, so the headline is the *age*, not the date.
 *      The date is the supporting evidence, one size down. (Reversible — see
 *      `dateFormat`, for people who want the calendar date to lead.)
 *   2. Never render more precision than the source carried — in either
 *      direction. A `year` candidate is "2024", a `minute` candidate keeps its
 *      clock time.
 *   3. Confidence is encoded three ways at once — marker shape, colour, and
 *      words — so it survives greyscale, colour blindness, and skimming.
 *   4. Escalation is earned. Exactly one element on screen is allowed to be
 *      loud, and only when the page actually contradicts itself.
 *
 * Every string comes from `lib/messages.ts`. None are built by concatenation:
 * see the note there about "about il y a 2 ans".
 */

export { display, fieldLabel, relativeAge, sourceLabel, tierWord }

/** innerHTML builds the layout; every interpolated value passes through here. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export const originOf = (url: string): string | null => {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

/**
 * Confidence gets a marker whose *shape* differs per tier — filled, half, ring
 * — not just a colour. Colour alone fails for roughly one reader in twelve, and
 * this popup exists to communicate exactly this distinction.
 */
const tierMarker = (): string => `<span class="marker" aria-hidden="true"></span>`

const provenance = (candidate: Candidate): string => `
  <p class="provenance">
    ${tierMarker()}
    <span class="tier">${escapeHtml(tierWord(candidate.confidence))}</span>
    <span class="sep" aria-hidden="true">·</span>
    <span class="source" data-source="${escapeHtml(candidate.source)}">${escapeHtml(sourceLabel(candidate.source))}</span>
  </p>`

/**
 * The primary answer: age first, date second, provenance third.
 *
 * `disputed` mutes the age rather than hiding it. Suppressing the number would
 * lose information; showing it at full confidence directly under a warning
 * that it is wrong would be the exact dishonesty this project is about.
 */
export function headline(
  label: string,
  candidate: Candidate,
  now: Date,
  disputed: boolean,
  format: DateFormat,
): string {
  const age = relativeAge(candidate, now)
  const exact = `<time datetime="${escapeHtml(candidate.value)}">${escapeHtml(display(candidate, format))}</time>`

  // Same DOM either way; only which fact is given the 21px slot changes. `iso`
  // is an absolute format too — the difference is how the date is written, not
  // which of the two facts leads.
  const datesLead = format !== 'relative'
  const lead = datesLead ? exact : age ? escapeHtml(age) : exact
  const support = datesLead ? (age ? escapeHtml(age) : '') : age ? exact : ''

  return `
    <header class="headline tier-${candidate.confidence}${disputed ? ' disputed' : ''}">
      <p class="age">${lead}</p>
      <p class="exact">
        <span class="field">${escapeHtml(label)}</span>
        ${support}
      </p>
      ${provenance(candidate)}
      ${candidate.note ? `<p class="note">${escapeHtml(candidate.note)}</p>` : ''}
    </header>`
}

/**
 * A secondary date, or its absence.
 *
 * "Not declared" is stated rather than omitted: silence would read as "we
 * didn't check", and the difference between *absent* and *unlooked-for* is
 * the whole reason to trust the rest of the panel.
 */
export function dateRow(
  label: string,
  candidate: Candidate | undefined,
  format: DateFormat = 'absolute',
): string {
  if (!candidate) {
    return `
      <div class="row absent">
        <span class="field">${escapeHtml(label)}</span>
        <span class="value">${escapeHtml(t('notDeclared'))}</span>
      </div>`
  }

  return `
    <div class="row tier-${candidate.confidence}">
      <div class="line">
        <span class="field">${escapeHtml(label)}</span>
        <time class="value" datetime="${escapeHtml(candidate.value)}">${escapeHtml(display(candidate, format))}</time>
      </div>
      ${provenance(candidate)}
      ${candidate.note ? `<p class="note">${escapeHtml(candidate.note)}</p>` : ''}
    </div>`
}

/**
 * The one element allowed to be loud — and only two of the three kinds are.
 *
 * `stale-declaration` is informational: the date shown is real, there is just
 * more to the story. Giving all three the same red treatment would make the
 * flag constant, and a constant flag is furniture.
 */
export function conflictBlock(result: DateResult): string {
  const conflict = result.conflict
  if (!conflict) return ''

  const { key, level } = {
    'declared-disagreement': { key: 'conflictDisagreement', level: 'alert' },
    'predated-content': { key: 'conflictPredated', level: 'alert' },
    'stale-declaration': { key: 'conflictStale', level: 'notice' },
  }[conflict.kind] as { key: MessageKey; level: string }

  return `
    <div class="conflict ${level}" role="note">
      <p class="conflict-heading">${escapeHtml(t(key))}</p>
      <p class="conflict-detail">${escapeHtml(conflict.detail)}</p>
    </div>`
}

/**
 * The evidence axis.
 *
 * One continuous time axis, dots at their true positions, no second scale. The
 * dots carry the same three marker shapes as the rows above, so nothing new has
 * to be learned to read it — and the endpoints are the only direct labels,
 * because a number on every point is noise at 360px.
 *
 * Marked `role="img"` with a summary rather than exposing twelve dots to a
 * screen reader: the disclosure list below is already the accessible table, and
 * duplicating it as unlabelled positions helps nobody.
 */
export function spreadAxis(spread: Spread, format: DateFormat = 'absolute'): string {
  const summary = t('spreadSummary', String(spread.total), spread.spanLabel)

  const dots = spread.points
    .map((point) => {
      const label = `${display(point.candidate, format)} — ${tierWord(point.candidate.confidence)}, ${sourceLabel(point.candidate.source)}`
      // Inline `left` because the position is data, not style. 5px of inset
      // keeps the endpoint dots fully on the track rather than half off it.
      return `<span
        class="pt tier-${point.candidate.confidence} role-${point.role}"
        style="left: calc(5px + (100% - 10px) * ${point.x.toFixed(4)})"
        title="${escapeHtml(label)}"
        aria-hidden="true"></span>`
    })
    .join('')

  return `
    <figure class="spread" role="img" aria-label="${escapeHtml(`${t('spreadTitle')}. ${summary}`)}">
      <figcaption>${escapeHtml(t('spreadTitle'))}</figcaption>
      <div class="axis">
        <span class="track" aria-hidden="true"></span>
        ${dots}
      </div>
      <div class="scale" aria-hidden="true">
        <span>${escapeHtml(spread.from.slice(0, 4))}</span>
        <span class="span">${escapeHtml(spread.spanLabel)}</span>
        <span>${escapeHtml(spread.to.slice(0, 4))}</span>
      </div>
    </figure>`
}

/** True when the conflict undermines the headline date itself. */
const undercutsHeadline = (result: DateResult): boolean =>
  result.conflict?.kind === 'declared-disagreement' || result.conflict?.kind === 'predated-content'

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

function candidateList(candidates: Candidate[], format: DateFormat = 'absolute'): string {
  const rows = [...candidates]
    .sort(byDateAscending)
    .map(
      (c) => `
        <li class="tier-${c.confidence}">
          ${tierMarker()}
          <span class="c-value">${escapeHtml(display(c, format))}</span>
          <span class="c-field">${escapeHtml(fieldLabel(c.field))}</span>
          <span class="c-source">${escapeHtml(sourceLabel(c.source))}</span>
        </li>`,
    )
    .join('')

  const count = String(candidates.length)
  const summary = candidates.length === 1 ? t('candidatesOne', count) : t('candidatesMany', count)

  return `
    <details class="more">
      <summary>${escapeHtml(summary)}</summary>
      <ul class="candidates">${rows}</ul>
    </details>`
}

export type ViewOptions = {
  fromCache?: boolean
  now?: Date
  dateFormat?: DateFormat
  /** When 'ask', the popup offers the archive check as an explicit action. */
  archive?: ArchiveMode
  /** Set once an archive lookup has run, so the offer is not repeated. */
  archiveChecked?: boolean
}

export function view(result: DateResult, url: string, options: ViewOptions = {}): string {
  const {
    fromCache = false,
    now = new Date(),
    dateFormat = 'relative',
    archive = 'off',
    archiveChecked = false,
  } = options
  const parts: string[] = []

  if (result.conflict) parts.push(conflictBlock(result))

  // Published leads when we have it. When we don't, the modification date is
  // the best answer available and is promoted rather than buried under a dash.
  const primary = result.published ?? result.modified
  const primaryLabel = result.published ? t('fieldPublished') : t('fieldModified')

  if (primary) {
    parts.push(headline(primaryLabel, primary, now, undercutsHeadline(result), dateFormat))
    // Whichever field did not lead is still reported, present or not. A page
    // that only says when it was updated must still say, out loud, that it
    // never claimed a publication date.
    parts.push(
      result.published
        ? dateRow(t('fieldModified'), result.modified, dateFormat)
        : dateRow(t('fieldPublished'), undefined, dateFormat),
    )
  } else {
    parts.push(`<p class="empty">${escapeHtml(t('emptyNoDate'))}</p>`)
  }

  const spread = computeSpread(result)
  if (isSpreadWorthShowing(spread, result) && spread) parts.push(spreadAxis(spread, dateFormat))

  const others = result.candidates.filter((c) => c !== result.published && c !== result.modified)
  if (others.length > 0) parts.push(candidateList(others, dateFormat))

  // Offered, never taken automatically: the lookup tells web.archive.org which
  // page is being read, so in "ask" mode the click is both the consent and the
  // user gesture the permission prompt requires.
  if (archive === 'ask' && primary && !result.conflict) {
    parts.push(
      archiveChecked
        ? `<p class="archive-result">${escapeHtml(t('archiveNothing'))}</p>`
        : `<button id="check-archive" type="button" class="wide">${escapeHtml(t('archiveCheck'))}</button>`,
    )
  }

  const host = originOf(url)?.replace(/^https?:\/\//, '') ?? ''
  parts.push(`
    <footer>
      <span class="host" title="${escapeHtml(host)}">${escapeHtml(host)}</span>
      <span class="actions">
        ${fromCache ? `<button id="refresh" type="button">${escapeHtml(t('recheck'))}</button>` : ''}
        <button id="open-settings" type="button" class="icon" title="${escapeHtml(t('settings'))}" aria-label="${escapeHtml(t('settings'))}">
          <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" fill="currentColor">
            <path d="M8 5.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6Zm0 4.3a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Z"/>
            <path d="m14.3 9.6-.9-.5a5.6 5.6 0 0 0 0-2.2l.9-.5a.7.7 0 0 0 .3-.9l-1-1.7a.7.7 0 0 0-.9-.3l-.9.5a5.5 5.5 0 0 0-1.9-1.1V1.9a.7.7 0 0 0-.7-.7H7.1a.7.7 0 0 0-.7.7v1a5.5 5.5 0 0 0-1.9 1.1l-.9-.5a.7.7 0 0 0-.9.3l-1 1.7a.7.7 0 0 0 .3.9l.9.5a5.6 5.6 0 0 0 0 2.2l-.9.5a.7.7 0 0 0-.3.9l1 1.7a.7.7 0 0 0 .9.3l.9-.5a5.5 5.5 0 0 0 1.9 1.1v1c0 .4.3.7.7.7h1.8a.7.7 0 0 0 .7-.7v-1a5.5 5.5 0 0 0 1.9-1.1l.9.5a.7.7 0 0 0 .9-.3l1-1.7a.7.7 0 0 0-.3-.9Z"/>
          </svg>
        </button>
      </span>
    </footer>`)

  return parts.join('')
}

export const unsupportedView = (): string =>
  `<p class="empty">${escapeHtml(t('emptyUnsupported'))}</p>`

export const errorView = (message: string): string =>
  `<p class="empty error">${escapeHtml(message)}</p>`
