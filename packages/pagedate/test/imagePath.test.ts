import { describe, expect, it } from 'vitest'
import { extractFromDocument } from '../src/index.js'
import { extractImagePath } from '../src/extract/imagePath.js'
import { rankCandidate } from '../src/resolve.js'
import { documentFrom } from './helpers.js'

describe('image upload paths', () => {
  it('reads a day-partitioned upload path from og:image', () => {
    const doc = documentFrom(
      '<meta property="og:image" content="https://www.eff.org/files/2016/05/04/ar-2015-og.png">',
    )

    const found = extractImagePath(doc)
    expect(found).toHaveLength(1)
    expect(found[0]?.value).toBe('2016-05-04')
    expect(found[0]?.precision).toBe('day')
    expect(found[0]?.field).toBe('published')
    expect(found[0]?.confidence).toBe('inferred')
    expect(found[0]?.source).toBe('image-path')
  })

  it('reads twitter:image too, and the misspelt `value` attribute', () => {
    const doc = documentFrom(
      '<meta name="twitter:image" value="/sites/default/files/2019/06/27/photo.jpg">',
    )

    expect(extractImagePath(doc)[0]?.value).toBe('2019-06-27')
  })

  it('ignores a monthly upload bucket', () => {
    // WordPress puts everything uploaded in May 2016 here, including the banner
    // the site has been reusing since. Measured: months are wrong more often
    // than they are right.
    const doc = documentFrom(
      '<meta property="og:image" content="https://example.com/wp-content/uploads/2016/05/banner.png">',
    )

    expect(extractImagePath(doc)).toEqual([])
  })

  it('ignores a path with no date in it', () => {
    const doc = documentFrom('<meta property="og:image" content="/static/img/logo.png">')
    expect(extractImagePath(doc)).toEqual([])
  })

  it('rejects a date the calendar does not have', () => {
    const doc = documentFrom('<meta property="og:image" content="/files/2016/02/31/x.png">')
    expect(extractImagePath(doc)).toEqual([])
  })

  it('emits one candidate when the same image is declared three ways', () => {
    const doc = documentFrom(`
      <meta property="og:image" content="https://cdn.example.com/files/2020/09/14/a.jpg">
      <meta property="og:image:secure_url" content="https://cdn.example.com/files/2020/09/14/a.jpg">
      <meta name="twitter:image" content="https://cdn.example.com/files/2020/09/14/a.jpg">`)

    expect(extractImagePath(doc)).toHaveLength(1)
  })

  it('loses to the URL slug, which is minted with the post', () => {
    const doc = documentFrom(
      '<meta property="og:image" content="https://example.com/files/2020/09/14/stock-photo.jpg">',
    )

    const candidates = extractFromDocument(doc, 'https://example.com/2022/03/12/the-post/')
    const slug = candidates.find((c) => c.source === 'url-slug')!
    const image = candidates.find((c) => c.source === 'image-path')!

    expect(rankCandidate(slug)).toBeGreaterThan(rankCandidate(image))
  })

  it('is collected in fast mode, since it costs nothing to read', () => {
    const doc = documentFrom(
      '<meta property="og:image" content="https://example.com/files/2020/09/14/a.jpg">',
    )

    const candidates = extractFromDocument(doc, 'https://example.com/post/', { mode: 'fast' })
    expect(candidates.some((c) => c.source === 'image-path')).toBe(true)
  })
})
