import type { DateResult } from 'pagedate'
import { display, relativeAge, sourceLabel, tierWord } from './format.js'
import { oldestCounterEvidence } from './evidence.js'
import { t } from './messages.js'
import type { DateFormat, OverlayMode, OverlayPosition } from './settings.js'

/**
 * The on-page readout.
 *
 * Most pages do not print their own date — it lives in JSON-LD or a meta tag —
 * so this is not duplicating something already on screen. For most of the web
 * it is the only place the date exists at all, which is why it is allowed to be
 * present always rather than only when something is wrong.
 *
 * That distinction matters: an *alert* has to stay rare to keep meaning, but an
 * ambient readout does not degrade by being constant. So this shows the age on
 * every page, quietly, and escalates within itself when the page contradicts
 * itself — rather than only appearing at that point.
 *
 * Being constant is also what forces it to be small. It carries the age and
 * nothing else; provenance is one click away, in the expanded state and in the
 * toolbar panel.
 */

export type OverlayTone = 'normal' | 'alert' | 'notice'

/** Everything the injected renderer needs, as plain serialisable data. */
export type OverlayData = {
  /** The collapsed readout: an age, or the muted no-date text. */
  age: string
  /** True when no date was found, which renders the readout recessive. */
  muted: boolean
  /** The expanded line: field, date, and provenance. */
  detail: string
  /** Conflict heading, when there is one. */
  conflict: string | null
  /**
   * On a page that is older than it claims, the age of the oldest hard
   * timestamp it carries — shown beside the declared age, because on those
   * pages the declared date is the claim rather than the answer.
   */
  counterAge: string | null
  /** The same fact spelled out for the expanded panel. */
  counterDetail: string | null
  tone: OverlayTone
  position: OverlayPosition
  /** Spoken label, so the collapsed pill is useful without expanding it. */
  label: string
}

export function overlayData(
  result: DateResult | null,
  now: Date,
  mode: OverlayMode,
  position: OverlayPosition,
  format: DateFormat = 'absolute',
): OverlayData | null {
  if (mode === 'never') return null

  // Nothing was read — a browser page, or a tab that closed. Absence of a
  // readout is honest here; a "no date" badge would claim we had looked.
  if (!result) return null

  if (mode === 'conflict' && !result.conflict) return null

  const tone: OverlayTone = !result.conflict
    ? 'normal'
    : result.conflict.kind === 'stale-declaration'
      ? 'notice'
      : 'alert'

  const conflict = result.conflict
    ? t(
        (
          {
            'declared-disagreement': 'conflictDisagreement',
            'predated-content': 'conflictPredated',
            'stale-declaration': 'conflictStale',
          } as const
        )[result.conflict.kind],
      )
    : null

  const primary = result.published ?? result.modified

  if (!primary) {
    return {
      age: t('overlayNoDate'),
      muted: true,
      detail: t('emptyNoDate'),
      conflict,
      counterAge: null,
      counterDetail: null,
      tone,
      position,
      label: t('overlayNoDate'),
    }
  }

  const label = result.published ? t('fieldPublished') : t('fieldModified')
  const age = relativeAge(primary, now) ?? display(primary, format)
  const detail = `${label} ${display(primary, format)} — ${tierWord(primary.confidence)}, ${sourceLabel(primary.source)}`

  const counter = oldestCounterEvidence(result)
  const counterAge = counter ? (relativeAge(counter, now) ?? display(counter, format)) : null

  return {
    age: counter ? t('overlaySays', age) : age,
    muted: false,
    detail,
    conflict,
    counterAge: counterAge ? t('overlayOldest', counterAge) : null,
    counterDetail: counter
      ? t(
          'overlayOldestDetail',
          display(counter, format),
          `${tierWord(counter.confidence)}, ${sourceLabel(counter.source)}`,
        )
      : null,
    tone,
    position,
    // Spoken as one sentence rather than two fragments, so the relationship
    // between the two dates survives without the visual layout.
    label:
      counter && counterAge
        ? `${t('overlayCounterLabel', age, counterAge)} ${detail}`
        : `${label} ${age}. ${detail}`,
  }
}

/** The id is shared by the painter and the remover, and must not collide. */
export const OVERLAY_ID = 'pagedate-overlay-8f2a'

/**
 * Injected into the page. MUST be self-contained.
 *
 * `executeScript` serialises this function with `toString()`, so anything it
 * closes over — an import, a module constant, a helper — is simply not there
 * when it runs. Every value it needs arrives in `data`, and the element id is
 * written out literally rather than referenced from `OVERLAY_ID`.
 */
export const paintOverlay = (data: OverlayData): void => {
  const ID = 'pagedate-overlay-8f2a'
  document.getElementById(ID)?.remove()

  const host = document.createElement('div')
  host.id = ID
  // The host is inert and unsized; only the button inside takes clicks, so the
  // page underneath keeps working everywhere the readout is not.
  host.setAttribute('style', 'all: initial; position: fixed; z-index: 2147483647;')

  const [vertical, horizontal] = data.position.split('-')
  host.style.setProperty(vertical === 'top' ? 'top' : 'bottom', '12px')
  host.style.setProperty(horizontal === 'left' ? 'left' : 'right', '12px')

  const root = host.attachShadow({ mode: 'open' })

  const style = document.createElement('style')
  style.textContent = `
    :host { all: initial; }
    * { box-sizing: border-box; margin: 0; }
    .pill {
      display: flex; align-items: center; gap: 6px;
      font: 500 11px/1.3 system-ui, -apple-system, "Segoe UI", sans-serif;
      font-variant-numeric: tabular-nums;
      padding: 4px 9px; border-radius: 999px; cursor: pointer;
      border: 1px solid rgba(0,0,0,.10);
      background: rgba(255,255,255,.86); color: #3c4450;
      box-shadow: 0 1px 3px rgba(0,0,0,.14);
      -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
      opacity: .72; transition: opacity 120ms ease;
      max-width: 60vw;
    }
    .pill:hover, .pill:focus-visible { opacity: 1; }
    .pill:focus-visible { outline: 2px solid #2563eb; outline-offset: 2px; }
    .pill.muted { font-style: italic; opacity: .55; }
    .pill.alert { color: #b3261e; border-color: rgba(179,38,30,.35); opacity: 1; }
    .pill.notice { color: #8a5a00; border-color: rgba(138,90,0,.35); opacity: 1; }
    .flag { font-weight: 700; }
    /* The declared age recedes and the evidence takes the weight: on these
       pages the declared date is the page's claim, not the answer. */
    .says { opacity: .7; font-weight: 400; }
    .sep { opacity: .35; }
    .counter { font-weight: 650; }
    .panel {
      display: none; margin-top: 6px; padding: 9px 11px; border-radius: 8px;
      font: 12px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif;
      border: 1px solid rgba(0,0,0,.10);
      background: rgba(255,255,255,.96); color: #22272f;
      box-shadow: 0 6px 20px rgba(0,0,0,.16);
      max-width: min(320px, 70vw);
    }
    .panel.open { display: block; }
    .panel .warn { font-weight: 650; margin-bottom: 3px; }
    .panel .warn.alert { color: #b3261e; }
    .panel .warn.notice { color: #8a5a00; }
    @media (prefers-color-scheme: dark) {
      .pill { background: rgba(28,31,37,.88); color: #c3cad4; border-color: rgba(255,255,255,.13); }
      .pill.alert { color: #f2837a; border-color: rgba(242,131,122,.38); }
      .pill.notice { color: #e0aa3e; border-color: rgba(224,170,62,.38); }
      .panel { background: rgba(28,31,37,.97); color: #e4e8ee; border-color: rgba(255,255,255,.13); }
      .panel .warn.alert { color: #f2837a; }
      .panel .warn.notice { color: #e0aa3e; }
    }
    /*
     * On touch there is no hover, so the resting state is the only state —
     * .72 opacity would simply be permanently half-legible. It rests brighter
     * instead, and grows to a thumb-sized target.
     */
    @media (pointer: coarse) {
      .pill { opacity: .92; padding: 9px 13px; font-size: 12px; min-height: 40px; }
      .panel { font-size: 13px; padding: 11px 13px; max-width: min(320px, 82vw); }
    }
    @media (prefers-reduced-motion: reduce) { .pill { transition: none; } }
  `

  const pill = document.createElement('button')
  pill.type = 'button'
  pill.className = `pill ${data.tone}${data.muted ? ' muted' : ''}`
  pill.setAttribute('aria-label', data.label)
  pill.setAttribute('aria-expanded', 'false')

  if (data.conflict) {
    const flag = document.createElement('span')
    flag.className = 'flag'
    flag.textContent = '!'
    flag.setAttribute('aria-hidden', 'true')
    pill.appendChild(flag)
  }

  const text = document.createElement('span')
  text.className = data.counterAge ? 'says' : ''
  text.textContent = data.age
  pill.appendChild(text)

  if (data.counterAge) {
    const sep = document.createElement('span')
    sep.className = 'sep'
    sep.textContent = '·'
    sep.setAttribute('aria-hidden', 'true')
    pill.appendChild(sep)

    const counter = document.createElement('span')
    counter.className = 'counter'
    counter.textContent = data.counterAge
    pill.appendChild(counter)
  }

  const panel = document.createElement('div')
  panel.className = 'panel'

  if (data.conflict) {
    const warn = document.createElement('p')
    warn.className = `warn ${data.tone}`
    warn.textContent = data.conflict
    panel.appendChild(warn)
  }

  const detail = document.createElement('p')
  detail.textContent = data.detail
  panel.appendChild(detail)

  if (data.counterDetail) {
    const counterLine = document.createElement('p')
    counterLine.textContent = data.counterDetail
    panel.appendChild(counterLine)
  }

  pill.addEventListener('click', () => {
    const open = panel.classList.toggle('open')
    pill.setAttribute('aria-expanded', open ? 'true' : 'false')
  })

  // Bottom-anchored corners open upward so the panel does not run off-screen.
  if (vertical === 'top') {
    root.append(style, pill, panel)
  } else {
    root.append(style, panel, pill)
    panel.style.marginTop = '0'
    panel.style.marginBottom = '6px'
  }

  document.documentElement.appendChild(host)
}

/** Also injected, also self-contained. */
export const clearOverlay = (): void => {
  document.getElementById('pagedate-overlay-8f2a')?.remove()
}
