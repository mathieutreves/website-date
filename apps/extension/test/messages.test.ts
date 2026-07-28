import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MESSAGES, t } from '../lib/messages.js'
import { buildLocale, localeFilePath } from '../lib/locale-source.js'

const ROOT = join(import.meta.dirname, '..')

describe('the generated locale file', () => {
  it('matches the table it is generated from', () => {
    // Fails when someone edits messages.ts without re-running the generator,
    // which is how a message file quietly drifts from the code.
    const onDisk = readFileSync(localeFilePath(ROOT), 'utf8')
    expect(onDisk).toBe(buildLocale())
  })

  it('is a valid browser.i18n catalogue', () => {
    const parsed = JSON.parse(readFileSync(localeFilePath(ROOT), 'utf8')) as Record<
      string,
      { message: string }
    >

    expect(Object.keys(parsed)).toEqual(Object.keys(MESSAGES))
    for (const [key, entry] of Object.entries(parsed)) {
      expect(entry.message, key).toBeTypeOf('string')
      expect(entry.message.length, key).toBeGreaterThan(0)
    }
  })

  it('uses no $-placeholders, which getMessage would consume itself', () => {
    // Substitution has to happen in exactly one place regardless of whether a
    // translation was found. See the note in messages.ts.
    for (const [key, message] of Object.entries(MESSAGES)) {
      expect(message, key).not.toMatch(/\$\d/)
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
