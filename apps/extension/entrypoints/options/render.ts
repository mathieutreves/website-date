import { t } from '../../lib/messages.js'
import type {
  ArchiveMode,
  DateFormat,
  OverlayMode,
  OverlayPosition,
  Settings,
} from '../../lib/settings.js'

/**
 * Pure view layer, same split as the popup: no browser APIs here, so the
 * markup can be asserted on directly.
 *
 * Two of these settings widen what the extension can reach. Each states what it
 * costs in the sentence next to it, in the reader's terms rather than the
 * manifest's — "read every site you visit", not "<all_urls>".
 */

export const escapeHtml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Kept simple on purpose: this is a reassurance, not an accounting figure. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const radio = (
  name: string,
  value: string,
  label: string,
  current: string,
  disabled = false,
): string => `
  <label class="choice">
    <input type="radio" name="${name}" value="${escapeHtml(value)}" ${value === current ? 'checked' : ''} ${disabled ? 'disabled' : ''} />
    ${escapeHtml(label)}
  </label>`

export type CacheStats = { count: number; bytes: number }

export function optionsView(settings: Settings, stats: CacheStats): string {
  const archive = (value: ArchiveMode, label: string) =>
    radio('archive', value, label, settings.archive)
  const format = (value: DateFormat, label: string) =>
    radio('dateFormat', value, label, settings.dateFormat)
  // The overlay is drawn by the background pass, so it cannot work without it.
  // Disabled rather than hidden: a setting you cannot find is worse than one
  // you can see the precondition for.
  const overlay = (value: OverlayMode, label: string) =>
    radio('overlay', value, label, settings.overlay, !settings.autoRead)
  const corner = (value: OverlayPosition, label: string) =>
    radio('overlayPosition', value, label, settings.overlayPosition)

  return `
    <header>
      <h1>${escapeHtml(t('optTitle'))}</h1>
      <p class="privacy">${escapeHtml(t('optPrivacyNote'))}</p>
    </header>

    <section>
      <h2>${escapeHtml(t('optReadingHeading'))}</h2>
      <div class="field">
        <div class="control">
          <label class="name" for="auto-read">${escapeHtml(t('optAutoRead'))}</label>
          <input type="checkbox" id="auto-read" ${settings.autoRead ? 'checked' : ''} />
        </div>
        <p class="help">${escapeHtml(t('optAutoReadHelp'))}</p>
        <p class="status" id="auto-read-status" hidden></p>
      </div>
    </section>

    <section>
      <h2>${escapeHtml(t('optOverlayHeading'))}</h2>
      <div class="field${settings.autoRead ? '' : ' disabled'}">
        <div class="control"><span class="name">${escapeHtml(t('optOverlay'))}</span></div>
        <p class="help">${escapeHtml(t('optOverlayHelp'))}</p>
        <div class="choices">
          ${overlay('always', t('optOverlayAlways'))}
          ${overlay('conflict', t('optOverlayConflict'))}
          ${overlay('never', t('optOverlayNever'))}
        </div>
        ${
          settings.autoRead
            ? ''
            : `<p class="status">${escapeHtml(t('optOverlayNeedsAutoRead'))}</p>`
        }
      </div>
      ${
        settings.overlay === 'never'
          ? ''
          : `<div class="field">
        <div class="control"><span class="name">${escapeHtml(t('optOverlayPosition'))}</span></div>
        <div class="choices">
          ${corner('bottom-left', t('optOverlayBottomLeft'))}
          ${corner('bottom-right', t('optOverlayBottomRight'))}
          ${corner('top-left', t('optOverlayTopLeft'))}
          ${corner('top-right', t('optOverlayTopRight'))}
        </div>
      </div>`
      }
    </section>

    <section>
      <h2>${escapeHtml(t('optArchiveHeading'))}</h2>
      <div class="field">
        <div class="control"><span class="name">${escapeHtml(t('optArchive'))}</span></div>
        <p class="help">${escapeHtml(t('optArchiveHelp'))}</p>
        <div class="choices">
          ${archive('off', t('optArchiveOff'))}
          ${archive('ask', t('optArchiveAsk'))}
          ${archive('always', t('optArchiveAlways'))}
        </div>
        <p class="status" id="archive-status" hidden></p>
      </div>
    </section>

    <section>
      <h2>${escapeHtml(t('optDisplayHeading'))}</h2>
      <div class="field">
        <div class="control"><span class="name">${escapeHtml(t('optDateFormat'))}</span></div>
        <div class="choices">
          ${format('relative', t('optDateFormatRelative'))}
          ${format('absolute', t('optDateFormatAbsolute'))}
        </div>
      </div>
    </section>

    <section>
      <h2>${escapeHtml(t('optDataHeading'))}</h2>
      <div class="field">
        <p class="cache-line" id="cache-line">${escapeHtml(
          stats.count === 0
            ? t('optCacheEmpty')
            : t('optCacheSummary', String(stats.count), formatBytes(stats.bytes)),
        )}</p>
        <p class="help">${escapeHtml(t('optCacheHelp'))}</p>
        <button type="button" id="clear-cache" ${stats.count === 0 ? 'disabled' : ''}>
          ${escapeHtml(t('optCacheClear'))}
        </button>
      </div>
    </section>`
}
