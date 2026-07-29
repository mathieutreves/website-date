import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MESSAGES, t, type MessageKey } from '../lib/messages.js'
import { TRANSLATIONS, type LocaleCode } from '../lib/locales/index.js'
import { LOCALE_CODES, buildLocale, catalogue, localeFilePath } from '../lib/locale-source.js'

const ROOT = join(import.meta.dirname, '..')

const KEYS = Object.keys(MESSAGES) as MessageKey[]
const CODES = Object.keys(TRANSLATIONS) as LocaleCode[]

/** `{1}`, `{2}` … in the order they appear. */
const placeholders = (message: string): string[] => message.match(/\{\d\}/g) ?? []

describe.each(LOCALE_CODES)('_locales/%s', (locale) => {
  const onDisk = () => readFileSync(localeFilePath(ROOT, locale), 'utf8')

  it('matches the table it is generated from', () => {
    // Fails when someone edits a catalogue without re-running the generator,
    // which is how a message file quietly drifts from the code.
    expect(onDisk()).toBe(buildLocale(locale))
  })

  it('is a valid browser.i18n catalogue', () => {
    const parsed = JSON.parse(onDisk()) as Record<string, { message: string }>

    expect(Object.keys(parsed)).toEqual(KEYS)
    for (const [key, entry] of Object.entries(parsed)) {
      expect(entry.message, key).toBeTypeOf('string')
      expect(entry.message.trim().length, key).toBeGreaterThan(0)
    }
  })

  it('fits the stores’ 132-character description limit', () => {
    // Every locale is a store listing in some language, and both stores
    // truncate past this silently rather than rejecting the upload.
    expect(catalogue(locale).extDescription.length).toBeLessThanOrEqual(132)
  })

  it('uses no $-placeholders, which getMessage would consume itself', () => {
    // Substitution has to happen in exactly one place regardless of whether a
    // translation was found. See the note in messages.ts.
    for (const [key, message] of Object.entries(catalogue(locale))) {
      expect(message, key).not.toMatch(/\$\d/)
    }
  })
})

/*
 * What the type system cannot reach.
 *
 * `Translation` being a total record already guarantees every key is present in
 * every language — a missing one will not compile. It cannot say anything about
 * the *contents*, and the two ways a drafted translation goes wrong are both
 * contents: a substitution silently dropped, and a string left in English.
 */
describe.each(CODES)('the %s translation', (code) => {
  const translated = TRANSLATIONS[code]

  it('keeps every substitution the English carries', () => {
    // A translation that drops `{1}` renders as a sentence with a hole in it —
    // "The page says , but the oldest date it carries is from 2011" — and no
    // type and no browser will object.
    for (const key of KEYS) {
      expect(placeholders(translated[key]).sort(), `${code}.${key}`).toEqual(
        placeholders(MESSAGES[key]).sort(),
      )
    }
  })

  it('translates the strings that carry meaning', () => {
    /*
     * Untouched English is what a half-finished catalogue looks like, and it is
     * invisible to every other check here.
     *
     * The exemptions are real, not a way of quieting the test: a brand, a
     * standard's name and a wire-format header are proper nouns, and the two
     * position labels genuinely coincide in some of these languages. `srcTimeTag`
     * and `optDateFormatIso` are mostly literal syntax — `<time>`, `2024-03-12` —
     * wrapped in a few translated words, so they are compared on the words.
     */
    const properNouns: MessageKey[] = ['extName', 'optArchiveHeading']
    for (const key of KEYS) {
      if (properNouns.includes(key)) continue
      // Latin-script languages legitimately share short words with English.
      if (MESSAGES[key].length < 12) continue
      expect(translated[key], `${code}.${key} is still English`).not.toBe(MESSAGES[key])
    }
  })

  it('never leaves a placeholder flush against a word', () => {
    /*
     * `{1}` is replaced by a phrase, not a number, in every key that has one, so
     * a missing separator reads as "says3 years ago".
     *
     * Latin script only, and that is the whole subtlety: Japanese and Chinese do
     * not space their words, so 約{1} — "about 3 years ago" — is not a missing
     * space, it is correct, and a script-blind version of this rule fails both
     * of those catalogues for writing themselves properly.
     */
    for (const key of KEYS) {
      expect(translated[key], `${code}.${key}`).not.toMatch(
        /\p{Script=Latin}\{\d\}|\{\d\}\p{Script=Latin}/u,
      )
    }
  })
})

describe('substitution', () => {
  it('fills placeholders positionally', () => {
    expect(t('spreadSummary', '5', '12 years')).toBe('5 dates found, spanning 12 years')
  })

  it('never leaves a raw placeholder in the UI', () => {
    expect(t('candidatesOne', '1')).toBe('1 other candidate')
    // A missing substitution renders as nothing rather than as "{1}".
    expect(t('candidatesOne')).not.toContain('{')
  })

  it('does not build sentences by concatenation', () => {
    // The bug this guards: 'about ' + Intl output reads as "about il y a 2 ans"
    // the moment the browser is not English.
    expect(MESSAGES.ageApprox).toContain('{1}')
  })
})
