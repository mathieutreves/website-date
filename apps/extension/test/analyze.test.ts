import { describe, expect, it } from 'vitest'
import { sameDocument } from '../lib/analyze.js'

/**
 * The guard behind the single-page-app fix.
 *
 * Reddit, GitHub and most of the modern web navigate with `history.pushState`:
 * the URL changes before the new view renders. A read fired on that event can
 * return the *previous* route's markup, which would then be cached under the
 * new URL and served as fact for a week. So a read has to prove it belongs to
 * the page it was asked about before anything trusts it.
 */
describe('proving a read belongs to the page it was asked about', () => {
  it('accepts the same document', () => {
    expect(sameDocument('https://x.com/a', 'https://x.com/a')).toBe(true)
  })

  it('accepts an in-page anchor, which is a position not a document', () => {
    expect(sameDocument('https://x.com/a#comments', 'https://x.com/a')).toBe(true)
  })

  it('refuses a different route, which is the SPA race', () => {
    // Reddit changes the URL before rendering the new post; without this the
    // previous post's DOM gets cached under the new URL for a week.
    expect(sameDocument('https://reddit.com/r/x/1', 'https://reddit.com/r/x/2')).toBe(false)
  })

  it('falls back to string equality on an unparseable URL', () => {
    expect(sameDocument('junk', 'junk')).toBe(true)
    expect(sameDocument('junk', 'other')).toBe(false)
  })
})
