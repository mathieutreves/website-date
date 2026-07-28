import { join } from 'node:path'
import { MESSAGES } from './messages.js'

/**
 * The shape of `_locales/en/messages.json`, with no side effects.
 *
 * Split from the generator script so a test can import it and compare against
 * what is on disk. If the writing lived here, importing it would rewrite the
 * file and the drift check would pass by definition.
 */

export const localeFilePath = (root: string): string =>
  join(root, 'public', '_locales', 'en', 'messages.json')

export function buildLocale(): string {
  const entries = Object.entries(MESSAGES).map(([key, message]) => [key, { message }])
  return `${JSON.stringify(Object.fromEntries(entries), null, 2)}\n`
}
