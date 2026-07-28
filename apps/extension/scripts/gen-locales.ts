import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { MESSAGES } from '../lib/messages.js'
import { buildLocale, localeFilePath } from '../lib/locale-source.js'

/**
 * Generate `_locales/en/messages.json` from the canonical table.
 *
 * Hand-maintaining both is how a UI ends up with a message file that has
 * drifted from the code — `messages.test.ts` fails if this has not been re-run.
 */

const out = localeFilePath(join(import.meta.dirname, '..'))
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, buildLocale())
console.log(`wrote ${Object.keys(MESSAGES).length} messages to ${out}`)
