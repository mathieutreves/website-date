import { describe, expect, it } from 'vitest'
import type { Candidate } from 'pagedate'
import { acceptPageRead } from '../lib/analyze.js'

/**
 * The guard on what comes back from the injected extractor.
 *
 * Extraction runs in the tab now, so what reaches the background is a value that
 * crossed a structured-clone boundary from a script running inside a page we do
 * not control. `PageRead` describes what it *should* be. This decides whether it
 * is, before a result gets cached under a URL for a week.
 */

const candidate = (value: string): Candidate => ({
  value,
  precision: 'day',
  field: 'published',
  confidence: 'declared',
  source: 'jsonld',
})

const read = (href: string, candidates: Candidate[] = [candidate('2024-03-12')]) => ({
  candidates,
  href,
})

describe('accepting a page read', () => {
  it('accepts a well-formed read', () => {
    expect(acceptPageRead(read('https://x.com/a'))).toHaveLength(1)
  })

  it('accepts an empty candidate list, which is a real answer', () => {
    // "This page carries no date" is the library's whole point. An empty array
    // is not a failed read, and treating it as one would turn every dateless
    // page into a retry.
    expect(acceptPageRead(read('https://x.com/a', []))).toEqual([])
  })

  it('refuses an injection that produced nothing', () => {
    // What `executeScript` resolves to on a frame that refused injection.
    expect(acceptPageRead(undefined)).toBeNull()
    expect(acceptPageRead(null)).toBeNull()
  })

  it('refuses a value of the wrong shape', () => {
    expect(acceptPageRead('not an object')).toBeNull()
    expect(acceptPageRead({ href: 'https://x.com/a' })).toBeNull()
    expect(acceptPageRead({ candidates: 'nope', href: 'https://x.com/a' })).toBeNull()
    expect(acceptPageRead({ candidates: [], href: 42 })).toBeNull()
  })

  it('refuses a read from a different route, which is the SPA race', () => {
    // Reddit changes the URL before rendering the new post. Without this the
    // previous post's candidates get cached under the new URL.
    expect(acceptPageRead(read('https://reddit.com/r/x/1'), 'https://reddit.com/r/x/2')).toBeNull()
  })

  it('accepts an in-page anchor, which is a position not a document', () => {
    expect(acceptPageRead(read('https://x.com/a#comments'), 'https://x.com/a')).toHaveLength(1)
  })

  it('does not check the URL when the caller did not ask it to', () => {
    // The popup reads on a click and cannot race the page; only the background,
    // which reads on navigation, passes an expected URL.
    expect(acceptPageRead(read('https://x.com/a'))).toHaveLength(1)
  })
})
