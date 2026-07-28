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
  host.style.setProperty(vertical === 'top' ? 'top' : 'bottom', '14px')
  host.style.setProperty(horizontal === 'left' ? 'left' : 'right', '14px')

  const root = host.attachShadow({ mode: 'open' })

  const style = document.createElement('style')
  /*
   * Opaque, and edged on every side.
   *
   * This is the one piece of UI in the extension that has to survive being
   * dropped onto a page it knows nothing about — any background colour, any
   * image, any density. Translucency and a blur made it a tint of whatever was
   * behind it, which is exactly the failure mode: on a busy page it read as
   * part of the page and stopped being findable. So there is no alpha here at
   * all. Solid fill, solid border, solid ledge beneath it.
   *
   * Being opaque is what lets it be quiet. A readout that is unambiguously a
   * separate object can afford small type and a neutral palette; the earlier
   * one had to compensate for its own transparency with a saturated state.
   *
   * The leading bar carries the tone. It is the only part legible before the
   * readout is read, and it is the same left-rule the popup uses for a
   * conflict, so the two surfaces escalate in the same visual language.
   */
  style.textContent = `
    :host {
      all: initial;
      --surface: #ffffff;
      --surface-hover: #f1f3f6;
      --fg: #16181d;
      --fg-muted: #5f6673;
      --edge: #454b55;
      --lip: #454b55;
      --accent: #0f766e;
      --on-accent: #ffffff;
      --focus: #2563eb;
    }
    * { box-sizing: border-box; margin: 0; }

    /* Tone lives in one variable, so the bar, the badge and the panel heading
       cannot drift apart. */
    .alert { --accent: #b3261e; }
    .notice { --accent: #8a5a00; }
    .pill.muted { --accent: #8b929e; }
    /* After .muted, and at the same specificity: a page with no date can still
       contradict itself, and the tone outranks the absence. */
    .pill.alert { --accent: #b3261e; --surface: #fdf3f2; --surface-hover: #fae8e6; }
    .pill.notice { --accent: #8a5a00; --surface: #fdf8ef; --surface-hover: #f8f0e0; }

    .pill {
      display: flex; align-items: center; gap: 7px;
      font: 600 12px/1.35 system-ui, -apple-system, "Segoe UI", sans-serif;
      font-variant-numeric: tabular-nums;
      padding: 6px 11px 6px 0; border-radius: 8px; cursor: pointer;
      border: 1.5px solid var(--edge);
      background: var(--surface); color: var(--fg);
      /* A hard ledge rather than a soft shadow: same job — lifting the readout
         off the page — without a blur that would let the page through it. */
      box-shadow: 0 2px 0 var(--lip);
      max-width: 60vw;
      transition: background-color 120ms ease, transform 120ms ease, box-shadow 120ms ease;
    }
    .pill::before {
      content: ""; flex: none; align-self: stretch;
      width: 5px; margin-right: 3px;
      background: var(--accent); border-radius: 6px 0 0 6px;
    }
    .pill:hover { background: var(--surface-hover); }
    .pill:active { transform: translateY(2px); box-shadow: 0 0 0 var(--lip); }
    .pill:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
    .age { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pill.muted .age { color: var(--fg-muted); font-style: italic; font-weight: 500; }
    /* A filled disc, not a bare glyph: at 12px an exclamation mark is four
       pixels of ink and reads as a speck of the page. */
    .flag {
      flex: none; display: inline-flex; align-items: center; justify-content: center;
      width: 15px; height: 15px; border-radius: 50%;
      background: var(--accent); color: var(--on-accent);
      font-size: 10px; font-weight: 700; line-height: 1;
    }
    /* The declared age recedes and the evidence takes the weight: on these
       pages the declared date is the page's claim, not the answer. */
    .says { color: var(--fg-muted); font-weight: 500; }
    .sep { color: var(--edge); }
    .counter { font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .panel {
      display: none; margin-top: 8px; padding: 10px 12px; border-radius: 8px;
      font: 400 12px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
      border: 1.5px solid var(--edge);
      background: var(--surface); color: var(--fg);
      box-shadow: 0 2px 0 var(--lip);
      max-width: min(340px, 70vw);
    }
    .panel.open { display: block; }
    .panel p + p { margin-top: 5px; color: var(--fg-muted); }
    .panel .warn { font-weight: 650; margin-bottom: 5px; color: var(--accent); }
    @media (prefers-color-scheme: dark) {
      :host {
        --surface: #1b1e24;
        --surface-hover: #23272f;
        --fg: #eef0f4;
        --fg-muted: #a1a8b4;
        --edge: #767d89;
        --lip: #05070a;
        --accent: #14b8a6;
        --on-accent: #16181d;
        --focus: #6ea8fe;
      }
      .alert { --accent: #f2837a; }
      .notice { --accent: #e0aa3e; }
      .pill.muted { --accent: #767d89; }
      .pill.alert { --accent: #f2837a; --surface: #2a1a19; --surface-hover: #35211f; }
      .pill.notice { --accent: #e0aa3e; --surface: #262019; --surface-hover: #302820; }
    }
    /* The page's own contrast preference applies to anything sitting on top of
       it: the border thickens and the ink goes to the ends of the ramp. */
    @media (prefers-contrast: more) {
      :host { --fg: #000000; --fg-muted: #33383f; --edge: #000000; --lip: #000000; }
      .alert { --accent: #8c1c16; }
      .notice { --accent: #6b4600; }
      .pill, .panel { border-width: 2px; }
      @media (prefers-color-scheme: dark) {
        :host { --fg: #ffffff; --fg-muted: #d2d7dd; --edge: #ffffff; --lip: #000000; }
        .alert { --accent: #ff9d94; }
        .notice { --accent: #fbbf24; }
      }
    }
    /* On touch there is no hover, so the resting state is the only state, and
       the target has to clear a thumb. */
    @media (pointer: coarse) {
      .pill { padding: 9px 13px 9px 0; font-size: 13px; min-height: 44px; }
      .pill::before { width: 6px; }
      .panel { font-size: 13px; padding: 12px 14px; max-width: min(340px, 82vw); }
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
  text.className = data.counterAge ? 'age says' : 'age'
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
    panel.style.marginBottom = '8px'
  }

  document.documentElement.appendChild(host)
}

/** Also injected, also self-contained. */
export const clearOverlay = (): void => {
  document.getElementById('pagedate-overlay-8f2a')?.remove()
}
