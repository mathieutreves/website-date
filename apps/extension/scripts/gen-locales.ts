import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { MESSAGES } from '../lib/messages.js'
import { LOCALE_CODES, buildLocale, localeFilePath } from '../lib/locale-source.js'

/**
 * Generate `_locales/<code>/messages.json` for every locale.
 *
 * Hand-maintaining these alongside the code is how a UI ends up with a message
 * file that has drifted from it — `messages.test.ts` fails if this has not been
 * re-run.
 *
 * The whole directory is removed first. Deleting a locale should delete its
 * catalogue too, and otherwise a dropped language keeps shipping from a stale
 * file that nothing generates and nothing checks.
 */

const root = join(import.meta.dirname, '..')

rmSync(dirname(dirname(localeFilePath(root))), { recursive: true, force: true })

for (const locale of LOCALE_CODES) {
  const out = localeFilePath(root, locale)
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, buildLocale(locale))
}

console.log(
  `wrote ${Object.keys(MESSAGES).length} messages × ${LOCALE_CODES.length} locales ` +
    `(${LOCALE_CODES.join(', ')})`,
)
