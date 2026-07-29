import { join } from 'node:path'
import { MESSAGES, type MessageKey } from './messages.js'
import { TRANSLATIONS, type LocaleCode } from './locales/index.js'

/**
 * The shape of every `_locales/<code>/messages.json`, with no side effects.
 *
 * Split from the generator script so a test can import it and compare against
 * what is on disk. If the writing lived here, importing it would rewrite the
 * files and the drift check would pass by definition.
 */

/** English is not in `TRANSLATIONS` — it is the table the rest are keyed to. */
export const DEFAULT_LOCALE = 'en'

export const LOCALE_CODES = [DEFAULT_LOCALE, ...Object.keys(TRANSLATIONS)] as const

export const localeFilePath = (root: string, locale: string = DEFAULT_LOCALE): string =>
  join(root, 'public', '_locales', locale, 'messages.json')

/** Every string for one locale, English for the default. */
export function catalogue(locale: string): Record<MessageKey, string> {
  return locale === DEFAULT_LOCALE ? MESSAGES : TRANSLATIONS[locale as LocaleCode]
}

export function buildLocale(locale: string = DEFAULT_LOCALE): string {
  const entries = Object.entries(catalogue(locale)).map(([key, message]) => [key, { message }])
  return `${JSON.stringify(Object.fromEntries(entries), null, 2)}\n`
}
