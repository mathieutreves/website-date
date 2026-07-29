import type { MessageKey } from '../messages.js'
import { de } from './de.js'
import { es } from './es.js'
import { fr } from './fr.js'
import { it } from './it.js'
import { ja } from './ja.js'
import { nl } from './nl.js'
import { ptBR } from './pt_BR.js'
import { zhCN } from './zh_CN.js'

/**
 * The translated catalogues.
 *
 * `Translation` is a total record over `MessageKey`, which is the point: adding
 * a string to `messages.ts` breaks every locale file at compile time, so a new
 * message cannot ship as an English leak in eight languages. The tests take it
 * from there and check what types cannot — that no translation dropped a `{1}`,
 * and that none of them are still the English.
 *
 * These were drafted by machine and are pending a human read. Three things
 * needed a decision rather than a lookup, and they are where a reviewer should
 * start:
 *
 *   The tier words. `tierDeclared` / `tierDerived` / `tierInferred` are the
 *   product — they say whether a date was asserted by the site, read out of its
 *   markup, or guessed. "Declared" flattening into "shown" would turn a claim
 *   about evidence into a claim about display, and nothing downstream would
 *   catch it.
 *
 *   `ageApprox` wraps output from `Intl.RelativeTimeFormat`, which arrives
 *   already formed — "il y a 3 ans", "hace 3 años". So the hedge has to go
 *   wherever that language puts it relative to a complete phrase, and in the
 *   Romance languages that is after it, not before. "environ il y a 3 ans" is
 *   the bug this key exists to prevent, written in French.
 *
 *   Plurals. `browser.i18n` has no plural support, so there are exactly two
 *   forms. That is right for the languages here — Japanese and Chinese take one
 *   form and the rest take two — but a language with a distinct few-form (the
 *   Slavic ones, Arabic) cannot be added correctly without either a third key
 *   or phrasing that sidesteps counting.
 */

export type Translation = Record<MessageKey, string>

export const TRANSLATIONS = {
  de,
  es,
  fr,
  it,
  ja,
  nl,
  // The directory name browsers expect: underscore, and a capitalised region.
  pt_BR: ptBR,
  zh_CN: zhCN,
} satisfies Record<string, Translation>

export type LocaleCode = keyof typeof TRANSLATIONS
