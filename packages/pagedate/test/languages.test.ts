import { describe, expect, it } from 'vitest'
import { parseDateString } from '../src/parse/normalize.js'
import { normaliseDigits } from '../src/parse/locale.js'
import { fieldFromLabel } from '../src/extract/labels.js'
import { extractFromDocument } from '../src/index.js'
import { documentFrom } from './helpers.js'

const DAY = { value: '2024-03-12', precision: 'day' } as const

describe('CJK dates', () => {
  it('reads the Chinese and Japanese year-month-day form', () => {
    expect(parseDateString('2024年3月12日')).toEqual(DAY)
    expect(parseDateString('2024年03月12日')).toEqual(DAY)
  })

  it('reads the Korean form', () => {
    expect(parseDateString('2024년 3월 12일')).toEqual(DAY)
  })

  it('keeps month precision when no day is given', () => {
    expect(parseDateString('2024年3月')).toEqual({ value: '2024-03', precision: 'month' })
  })

  it('needs no locale hint, since the order is unambiguous', () => {
    // Year-first leaves nothing to guess about.
    expect(parseDateString('2024年3月12日', { dayFirst: 'month-first' })).toEqual(DAY)
  })
})

describe('Cyrillic dates', () => {
  it('reads Russian months in the genitive, as dates actually use them', () => {
    // "12 марта 2024", not the dictionary form "март".
    expect(parseDateString('12 марта 2024')).toEqual(DAY)
    expect(parseDateString('1 января 2020')).toEqual({ value: '2020-01-01', precision: 'day' })
  })

  it('still reads the nominative form', () => {
    expect(parseDateString('12 март 2024')).toEqual(DAY)
  })

  it('reads Ukrainian', () => {
    expect(parseDateString('12 березня 2024')).toEqual(DAY)
  })
})

describe('other European languages', () => {
  it('reads Polish genitive months', () => {
    expect(parseDateString('12 marca 2024')).toEqual(DAY)
  })

  it('reads Czech', () => {
    expect(parseDateString('12. března 2024')).toEqual(DAY)
  })

  it('reads Turkish, including the dotless i', () => {
    expect(parseDateString('12 Mart 2024')).toEqual(DAY)
    expect(parseDateString('12 Mayıs 2024')).toEqual({ value: '2024-05-12', precision: 'day' })
  })

  it('reads Greek genitive months', () => {
    expect(parseDateString('12 Μαρτίου 2024')).toEqual(DAY)
  })

  it('reads Finnish partitive months', () => {
    expect(parseDateString('12. maaliskuuta 2024')).toEqual(DAY)
  })

  it('reads Swedish, Romanian, Hungarian and Indonesian', () => {
    expect(parseDateString('12 mars 2024')).toEqual(DAY)
    expect(parseDateString('12 martie 2024')).toEqual(DAY)
    expect(parseDateString('12 március 2024')).toEqual(DAY)
    expect(parseDateString('12 Maret 2024')).toEqual(DAY)
  })
})

describe('non-Latin scripts', () => {
  it('reads Arabic month names in both naming systems', () => {
    // Gulf/Egyptian and Levantine names are unrelated to each other.
    expect(parseDateString('12 مارس 2024')).toEqual(DAY)
    expect(parseDateString('12 آذار 2024')).toEqual(DAY)
  })

  it('reads Arabic-Indic numerals', () => {
    // Without digit normalisation this page appears to contain no date at all.
    expect(normaliseDigits('١٢')).toBe('12')
    expect(parseDateString('١٢ مارس ٢٠٢٤')).toEqual(DAY)
  })

  it('reads Devanagari numerals and Hindi months', () => {
    expect(parseDateString('१२ मार्च २०२४')).toEqual(DAY)
  })

  it('reads Hebrew', () => {
    expect(parseDateString('12 מרץ 2024')).toEqual(DAY)
  })

  it('reads full-width digits', () => {
    expect(parseDateString('２０２４年３月１２日')).toEqual(DAY)
  })
})

describe('labels in other languages', () => {
  it('tells published from modified across scripts', () => {
    for (const phrase of ['最后更新', '最終更新', '최종 수정', 'обновлено', 'آخر تحديث', 'ostatnia aktualizacja']) {
      expect(fieldFromLabel(phrase), phrase).toBe('modified')
    }

    for (const phrase of ['发布于', '公開日', '게시일', 'опубликовано', 'تاريخ النشر', 'publicerad']) {
      expect(fieldFromLabel(phrase), phrase).toBe('published')
    }
  })

  it('prefers the update label when a line mentions both', () => {
    expect(fieldFromLabel('опубликовано 1 января, обновлено 3 марта')).toBe('modified')
  })
})

describe('end to end on non-English pages', () => {
  const extract = (html: string, url: string, lang: string) =>
    extractFromDocument(documentFrom(`<html lang="${lang}">${html}</html>`), url)

  it('reads a Japanese article byline', () => {
    const found = extract(
      `<body><article><p class="date">公開日：2024年3月12日</p><p>本文</p></article></body>`,
      'https://example.jp/article',
      'ja',
    )

    expect(found.find((c) => c.field === 'published')?.value).toBe('2024-03-12')
  })

  it('reads a Russian update line', () => {
    const found = extract(
      `<body><article><p>Обновлено: 12 марта 2024</p></article></body>`,
      'https://example.ru/stat',
      'ru',
    )

    expect(found.find((c) => c.field === 'modified')?.value).toBe('2024-03-12')
  })

  it('reads an Arabic publication line', () => {
    const found = extract(
      `<body><article><p>تاريخ النشر: 12 مارس 2024</p></article></body>`,
      'https://example.sa/x',
      'ar',
    )

    expect(found.find((c) => c.field === 'published')?.value).toBe('2024-03-12')
  })

  it('does not treat a year-first locale as month-first', () => {
    // zh/ja/ko write year-first; an ambiguous numeric date there is day-first,
    // never American order.
    const found = extract(
      `<body><article><p>发布于 03/04/2024</p></article></body>`,
      'https://example.cn/x',
      'zh',
    )

    expect(found.find((c) => c.field === 'published')?.value).toBe('2024-04-03')
  })
})
