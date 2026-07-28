import { describe, expect, it } from 'vitest'
import { parseDateString, toInstant } from '../src/parse/normalize.js'
import { detectDayFirst } from '../src/parse/locale.js'

describe('parseDateString', () => {
  it('parses ISO timestamps to minute precision, preserving the offset', () => {
    expect(parseDateString('2023-04-11T10:30:00Z')).toEqual({
      value: '2023-04-11T10:30Z',
      precision: 'minute',
    })
    expect(parseDateString('2023-04-11T10:30:00+02:00')).toEqual({
      value: '2023-04-11T10:30+02:00',
      precision: 'minute',
    })
  })

  it('never inflates precision', () => {
    expect(parseDateString('2024')).toEqual({ value: '2024', precision: 'year' })
    expect(parseDateString('2024-03')).toEqual({ value: '2024-03', precision: 'month' })
    expect(parseDateString('2024-03-12')).toEqual({ value: '2024-03-12', precision: 'day' })
  })

  it('parses RFC 2822 as used by RSS pubDate', () => {
    expect(parseDateString('Tue, 11 Apr 2023 10:00:00 GMT')).toEqual({
      value: '2023-04-11T10:00Z',
      precision: 'minute',
    })
  })

  it('rejects structurally impossible dates rather than rolling them over', () => {
    expect(parseDateString('2023-02-30')).toBeNull()
    expect(parseDateString('2023-13-01')).toBeNull()
  })

  describe('all-numeric dates', () => {
    it('settles the order when one component can only be a day', () => {
      expect(parseDateString('25/03/2024')).toEqual({ value: '2024-03-25', precision: 'day' })
      expect(parseDateString('03/25/2024')).toEqual({ value: '2024-03-25', precision: 'day' })
    })

    it('uses the locale hint when both readings are possible', () => {
      expect(parseDateString('03/04/2024', { dayFirst: 'day-first' })).toEqual({
        value: '2024-04-03',
        precision: 'day',
      })
      expect(parseDateString('03/04/2024', { dayFirst: 'month-first' })).toEqual({
        value: '2024-03-04',
        precision: 'day',
      })
    })

    it('degrades to year precision rather than guessing when truly ambiguous', () => {
      // Neither 03 nor 04 can be ruled out as the month, and no hint is
      // available — a confident wrong day is worse than a vague right year.
      expect(parseDateString('03/04/2024')).toEqual({ value: '2024', precision: 'year' })
    })
  })

  describe('month names', () => {
    it('reads English in both orders', () => {
      expect(parseDateString('12 March 2024')).toEqual({ value: '2024-03-12', precision: 'day' })
      expect(parseDateString('March 12, 2024')).toEqual({ value: '2024-03-12', precision: 'day' })
    })

    it('reads Italian', () => {
      expect(parseDateString('12 marzo 2024')).toEqual({ value: '2024-03-12', precision: 'day' })
      expect(parseDateString('3 dicembre 2021')).toEqual({ value: '2021-12-03', precision: 'day' })
    })

    it('handles diacritics and other languages', () => {
      expect(parseDateString('12 février 2024')).toEqual({ value: '2024-02-12', precision: 'day' })
      expect(parseDateString('12 de marzo de 2024')).toEqual({
        value: '2024-03-12',
        precision: 'day',
      })
    })

    it('keeps month precision when no day was stated', () => {
      expect(parseDateString('March 2024')).toEqual({ value: '2024-03', precision: 'month' })
    })
  })
})

describe('detectDayFirst', () => {
  it('treats en-US as month-first and everything else as day-first', () => {
    expect(detectDayFirst('en-US')).toBe('month-first')
    expect(detectDayFirst('en-GB')).toBe('day-first')
    expect(detectDayFirst('it')).toBe('day-first')
  })

  it('prefers the declared language over the TLD', () => {
    // A .com serving Italian is far more common than a .it serving en-US.
    expect(detectDayFirst('it', 'example.com')).toBe('day-first')
  })

  it('falls back to the TLD when the language is ambiguous', () => {
    expect(detectDayFirst('en', 'example.it')).toBe('day-first')
    expect(detectDayFirst(null, 'example.us')).toBe('month-first')
    expect(detectDayFirst(null, 'example.com')).toBe('unknown')
  })
})

describe('toInstant', () => {
  it('resolves partial values to the start of their period', () => {
    expect(toInstant('2024')?.toISOString()).toBe('2024-01-01T00:00:00.000Z')
    expect(toInstant('2024-03')?.toISOString()).toBe('2024-03-01T00:00:00.000Z')
  })
})
