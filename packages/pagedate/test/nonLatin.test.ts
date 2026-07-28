import { describe, expect, it } from 'vitest'
import { extractFromDocument, resolveCandidates } from '../src/index.js'
import { extractJsonLd } from '../src/extract/jsonld.js'
import { documentFrom, NOW } from './helpers.js'
import { fixtureDocument, loadFixtures } from './corpus.js'

/**
 * Non-Latin pages, tested for what they must *not* do.
 *
 * Every major site emits metadata, so on a real Japanese or Korean page the
 * declared date wins and the native-script parsing never decides the answer.
 * What these pages do exercise — and what the unit tests cannot — is whether a
 * native-script date sitting in site furniture, a promo block, or running prose
 * gets mistaken for the article's own date now that the parser can read them.
 *
 * Reading a script is what makes misreading it possible, so this is exactly
 * where the language work needed real-page coverage.
 */

const load = (slug: string) => {
  const fixture = loadFixtures().find((f) => f.slug === slug)
  if (!fixture) throw new Error(`missing fixture ${slug}`)
  return {
    result: resolveCandidates(extractFromDocument(fixtureDocument(fixture), fixture.url), {
      now: NOW,
    }),
    fixture,
  }
}

describe('native-script dates in the wrong place', () => {
  it('ignores a Korean newspaper registration date in the footer', () => {
    // hani.co.kr prints "등록·발행일자 : 2011년 7월 19일" in its footer — the
    // registration date of the publication, not of this article.
    const { result } = load('hani-korean-news')

    expect(result.published?.value.slice(0, 10)).toBe('2026-07-28')
    expect(result.candidates.some((c) => c.value.startsWith('2011'))).toBe(false)
  })

  it('ignores a Devanagari date belonging to a linked promo', () => {
    // BBC Hindi renders "25 जुलाई 2026" inside a Promo_timestamp block for a
    // different article.
    const { result } = load('bbc-hindi-news')

    expect(result.published?.value.slice(0, 10)).toBe('2026-07-28')
    expect(result.candidates.some((c) => c.value.startsWith('2026-07-25'))).toBe(false)
  })

  it('ignores a CJK date that is the subject of the article, not its date', () => {
    // The BBC Chinese piece is about the Tangshan earthquake and prints
    // 1976年7月28日 in its opening sentence.
    const { result } = load('bbc-chinese-news')

    expect(result.published?.value.slice(0, 10)).toBe('2026-07-28')
    expect(result.candidates.some((c) => c.value.startsWith('1976'))).toBe(false)
    // And an ancient date in prose must not read as evidence the page is older.
    expect(result.conflict).toBeUndefined()
  })

  it('does not let a nested VideoObject uploadDate outrank the article', () => {
    const { result } = load('aljazeera-arabic-news')

    expect(result.published?.source).toBe('jsonld')
    expect(result.modified?.value.slice(0, 10)).toBe('2026-07-28')
  })
})

describe('schema.org article subtypes', () => {
  it('treats any *Article or *Posting subtype as content, not a container', () => {
    // Enumerating subtypes was already wrong in practice: BBC's
    // AnalysisNewsArticle ranked below its own OpenGraph tags.
    for (const type of [
      'AnalysisNewsArticle',
      'ReportageNewsArticle',
      'OpinionNewsArticle',
      'SatiricalArticle',
      'DiscussionForumPosting',
    ]) {
      const doc = documentFrom(
        `<script type="application/ld+json">
         {"@type":"${type}","datePublished":"2024-03-12"}
         </script>`,
      )

      const found = extractJsonLd(doc)
      expect(found[0]?.source, type).toBe('jsonld')
      expect(found[0]?.note, type).not.toContain('container')
    }
  })

  it('still marks genuine container types as containers', () => {
    const doc = documentFrom(
      `<script type="application/ld+json">{"@type":"WebPage","datePublished":"2024-03-12"}</script>`,
    )

    expect(extractJsonLd(doc)[0]?.source).toBe('jsonld-container')
  })
})
