import type { Toast } from './link-menu.js'
import { t } from './messages.js'

/**
 * The transient readout for a right-click check.
 *
 * A toast rather than a browser notification, and rather than the popup. A
 * notification needs its own permission, is queued by the OS, and survives the
 * moment it belongs to — all wrong for an answer about a link you just pointed
 * at. The popup cannot be opened programmatically in MV3 on either browser
 * without a fresh user gesture that a context-menu handler no longer has by the
 * time an async fetch has resolved.
 *
 * So: a small panel in the corner of the page you are already on, which removes
 * itself. Same shadow-root isolation and the same opaque treatment as the
 * overlay, for the same reason — it lands on a page it knows nothing about.
 */

export const TOAST_ID = 'pagedate-toast-8f2a'

export type ToastData = Toast & {
  /** Milliseconds before it removes itself. */
  ttlMs: number
  /**
   * The close button's accessible name. Carried in the data because the
   * renderer is serialised into the page, where there is no `i18n` to ask — a
   * literal written there is English for every reader, in a control whose only
   * text is what a screen reader announces.
   */
  dismissLabel: string
}

export const toastData = (toast: Toast, ttlMs = 9000): ToastData => ({
  ...toast,
  ttlMs,
  dismissLabel: t('toastDismiss'),
})

/**
 * How long the "checking…" toast may stay: a little past the fetch timeout, so
 * it is always replaced by an answer rather than expiring into silence.
 */
export const CHECKING_TTL_MS = 12_000

/**
 * Injected into the page. MUST be self-contained — see the note on
 * `paintOverlay`. Nothing it closes over exists at the far end, so the id is
 * written out literally and every value arrives in `data`.
 */
export const paintToast = (data: ToastData): void => {
  const ID = 'pagedate-toast-8f2a'
  document.getElementById(ID)?.remove()

  const TONES: Record<string, string> = {
    declared: '#0f766e',
    derived: '#c2410c',
    inferred: '#5f6673',
    alert: '#b3261e',
    muted: '#5f6673',
  }

  const host = document.createElement('div')
  host.id = ID
  host.setAttribute(
    'style',
    'all: initial; position: fixed; z-index: 2147483647; bottom: 14px; right: 14px;',
  )

  const root = host.attachShadow({ mode: 'open' })

  const style = document.createElement('style')
  style.textContent = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .card {
      display: flex; gap: 10px; align-items: flex-start;
      max-width: 340px; padding: 10px 12px;
      font: 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif;
      color: #16181d; background: #ffffff;
      border: 1px solid #454b55; border-radius: 10px;
      box-shadow: 0 2px 0 #454b55, 0 6px 18px rgba(0,0,0,.18);
      animation: in 140ms ease-out;
    }
    @keyframes in { from { opacity: 0; transform: translateY(4px); } }
    @media (prefers-reduced-motion: reduce) { .card { animation: none; } }
    .disc { width: 9px; height: 9px; border-radius: 50%; margin-top: 5px; flex: 0 0 auto; }
    .text { min-width: 0; }
    .heading { font-weight: 600; }
    .detail { color: #5f6673; margin-top: 2px; word-break: break-word; }
    .close {
      all: unset; cursor: pointer; margin-left: auto; padding: 0 2px;
      color: #5f6673; font-size: 15px; line-height: 1;
    }
    .close:hover { color: #16181d; }
    .close:focus-visible { outline: 2px solid #0f766e; outline-offset: 2px; }
    @media (prefers-color-scheme: dark) {
      .card { color: #f2f4f7; background: #1b1e24; border-color: #6b727f; box-shadow: 0 2px 0 #6b727f, 0 6px 18px rgba(0,0,0,.5); }
      .detail, .close { color: #a8b0bd; }
      .close:hover { color: #f2f4f7; }
    }
  `

  const card = document.createElement('div')
  card.className = 'card'
  // A status rather than an alert: this is the answer to something the reader
  // just asked for, so it should be announced without interrupting them.
  card.setAttribute('role', 'status')
  card.setAttribute('aria-live', 'polite')

  const disc = document.createElement('div')
  disc.className = 'disc'
  disc.style.background = TONES[data.tone] ?? TONES.muted!

  const text = document.createElement('div')
  text.className = 'text'

  const heading = document.createElement('div')
  heading.className = 'heading'
  // textContent throughout: the detail carries a hostname taken from a link on
  // an untrusted page.
  heading.textContent = data.heading

  const detail = document.createElement('div')
  detail.className = 'detail'
  detail.textContent = data.detail

  const close = document.createElement('button')
  close.className = 'close'
  close.textContent = '×'
  close.setAttribute('aria-label', data.dismissLabel)
  close.addEventListener('click', () => host.remove())

  text.append(heading, detail)
  card.append(disc, text, close)
  root.append(style, card)
  document.documentElement.append(host)

  setTimeout(() => host.remove(), data.ttlMs)
}
