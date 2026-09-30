import { describe, expect, it } from 'vitest'
import type { Candidate } from 'pagedate'
import {
  checkingToast,
  checkLink,
  hostOf,
  toastFor,
  type MenuDeps,
  type MenuOutcome,
} from '../lib/link-menu.js'
import { CHECKING_TTL_MS, paintToast, toastData } from '../lib/toast.js'
import { dateFromUrl } from '../lib/link-date.js'

const NOW = new Date('2026-07-28T12:00:00Z')

const declared: Candidate = {
  value: '2019-03-04',
  precision: 'day',
  field: 'published',
  source: 'jsonld',
  confidence: 'declared',
}

/** Records what was asked for, so the escalation order can be asserted. */
function deps(over: Partial<MenuDeps> = {}) {
  const calls: string[] = []
  const base: MenuDeps = {
    hasOrigin: async () => {
      calls.push('hasOrigin')
      return false
    },
    requestOrigin: async () => {
      calls.push('requestOrigin')
      return true
    },
    releaseOrigin: async () => {
      calls.push('releaseOrigin')
    },
    readPage: async () => {
      calls.push('readPage')
      return [declared]
    },
    now: NOW,
    ...over,
  }
  return { deps: base, calls }
}

describe('checkLink', () => {
  it('answers from the URL without asking for anything', async () => {
    const { deps: d, calls } = deps()
    const outcome = await checkLink('https://example.com/2019/03/04/post/', d)

    expect(outcome).toMatchObject({ kind: 'dated' })
    expect(outcome.kind === 'dated' && outcome.link.tier).toBe('url')
    // The point of the whole escalation: no prompt, no request.
    expect(calls).toEqual([])
  })

  it('asks for one origin, reads, and hands the origin back', async () => {
    const { deps: d, calls } = deps()
    const outcome = await checkLink('https://example.com/docs/thing', d)

    expect(outcome).toMatchObject({ kind: 'dated' })
    expect(calls).toEqual(['hasOrigin', 'requestOrigin', 'readPage', 'releaseOrigin'])
  })

  /*
   * A permission prompt needs the click's user gesture, and Firefox counts it
   * as spent after the first `await`. So the request has to have been *made*
   * by the time `checkLink` first yields — which is what calling it and not
   * awaiting it observes.
   */
  it('makes the permission request before it awaits anything', () => {
    const { deps: d, calls } = deps({
      // Never settles: if the request waited on this, it would never be made.
      hasOrigin: () => {
        calls.push('hasOrigin')
        return new Promise<boolean>(() => {})
      },
    })

    void checkLink('https://example.com/docs/thing', d)

    expect(calls).toEqual(['hasOrigin', 'requestOrigin'])
  })

  /*
   * An origin that was already granted belongs to a setting — automatic
   * reading, or a search engine — and removing it would switch that feature
   * off behind the reader's back.
   */
  it('leaves alone a grant that was there before the click', async () => {
    const { deps: d, calls } = deps({ hasOrigin: async () => true })
    await checkLink('https://example.com/docs/thing', d)

    expect(calls).toContain('readPage')
    expect(calls).not.toContain('releaseOrigin')
  })

  it('does not remove a grant it could not check', async () => {
    const { deps: d, calls } = deps({
      hasOrigin: async () => {
        throw new Error('permissions unavailable')
      },
    })
    await checkLink('https://example.com/docs/thing', d)

    expect(calls).not.toContain('releaseOrigin')
  })

  it('hands the origin back when the read fails too', async () => {
    const { deps: d, calls } = deps({
      readPage: async () => {
        throw new Error('tab closed')
      },
    })
    expect(await checkLink('https://example.com/docs/thing', d)).toEqual({ kind: 'unreachable' })
    expect(calls).toContain('releaseOrigin')
  })

  it('stops at "denied" and reads nothing when the prompt is refused', async () => {
    const { deps: d, calls } = deps({ requestOrigin: async () => false })
    const outcome = await checkLink('https://example.com/docs/thing', d)

    expect(outcome).toEqual({ kind: 'denied' })
    expect(calls).not.toContain('readPage')
  })

  it('treats a rejected request as a refusal', async () => {
    const { deps: d } = deps({
      requestOrigin: async () => {
        throw new Error('may only be called from a user input handler')
      },
    })
    expect(await checkLink('https://example.com/docs/thing', d)).toEqual({ kind: 'denied' })
  })

  it('says it is reading only once there is something to wait for', async () => {
    const log: string[] = []
    const { deps: d } = deps({
      requestOrigin: async () => {
        log.push('request')
        return true
      },
      onReading: () => log.push('reading'),
      readPage: async () => {
        log.push('read')
        return [declared]
      },
    })
    await checkLink('https://example.com/docs/thing', d)
    expect(log).toEqual(['request', 'reading', 'read'])

    // The address answered, or the prompt was refused: nothing to announce.
    const quiet: string[] = []
    await checkLink('https://example.com/2019/03/04/post/', { ...d, onReading: () => quiet.push('x') })
    await checkLink('https://example.com/docs/thing', {
      ...d,
      requestOrigin: async () => false,
      onReading: () => quiet.push('x'),
    })
    expect(quiet).toEqual([])
  })

  it('distinguishes a page it could not read from one with no date', async () => {
    const unreadable = await checkLink(
      'https://example.com/docs/thing',
      deps({ readPage: async () => null }).deps,
    )
    expect(unreadable).toEqual({ kind: 'unreachable' })

    const empty = await checkLink(
      'https://example.com/docs/thing',
      deps({ readPage: async () => [] }).deps,
    )
    expect(empty).toEqual({ kind: 'none' })
  })

  it('never prompts for a scheme it cannot fetch', async () => {
    const { deps: d, calls } = deps()
    expect(await checkLink('javascript:alert(1)', d)).toEqual({ kind: 'none' })
    expect(calls).toEqual([])
  })
})

describe('the toast', () => {
  it('has a "checking" state that says which site it is about', () => {
    const toast = checkingToast('example.com')
    expect(toast.heading).toMatch(/checking/i)
    expect(toast.detail).toContain('example.com')
  })

  /*
   * `paintToast` is serialised into the page, where there is no i18n to ask.
   * The close button's name therefore has to arrive in the data, and a literal
   * in the function body is English for every reader.
   */
  it('carries the dismiss label in, rather than hardcoding it in the page', () => {
    expect(toastData(checkingToast('example.com')).dismissLabel).toBe('Dismiss')
    expect(paintToast.toString()).toContain('data.dismissLabel')
    expect(paintToast.toString()).not.toMatch(/['"]Dismiss['"]/)
  })

  it('keeps "checking" on screen longer than the fetch can take', () => {
    expect(CHECKING_TTL_MS).toBeGreaterThan(8000)
  })
})

describe('toastFor', () => {
  const dated = (url: string): MenuOutcome => {
    const link = dateFromUrl(url, NOW)
    if (!link) throw new Error('fixture URL carries no date')
    return { kind: 'dated', link }
  }

  it('leads with the date and names the host', () => {
    const toast = toastFor(dated('https://example.com/2019/03/04/post/'), 'example.com', NOW)

    expect(toast.heading).toContain('Published')
    expect(toast.heading).toContain('2019')
    expect(toast.detail).toContain('example.com')
  })

  /*
   * A URL-tier reading is a guess about an address, and must not borrow the
   * authority of a declared date. Tone and wording both have to say so.
   */
  it('marks a URL-tier answer as inferred', () => {
    const toast = toastFor(dated('https://example.com/2019/03/04/post/'), 'example.com', NOW)

    expect(toast.tone).toBe('inferred')
    expect(toast.detail).toContain('link address')
  })

  it('renders an ISO date when that is the stored preference', () => {
    const toast = toastFor(dated('https://example.com/2019/03/04/post/'), 'example.com', NOW, 'iso')
    expect(toast.heading).toContain('2019-03-04')
  })

  /*
   * Each failure is a statement about what this tool could not learn, never
   * about the page. "Could not read that page" and "that page has no date" are
   * different claims and only one of them is ours to make.
   */
  it('separates could-not-read from has-no-date from was-refused', () => {
    expect(toastFor({ kind: 'unreachable' }, 'example.com', NOW).heading).toMatch(/could not read/i)
    expect(toastFor({ kind: 'none' }, 'example.com', NOW).heading).toMatch(/no date found/i)
    expect(toastFor({ kind: 'denied' }, 'example.com', NOW).heading).toMatch(/permission/i)
  })

  it('renders every failure in the muted tone', () => {
    for (const kind of ['unreachable', 'none', 'denied'] as const) {
      expect(toastFor({ kind }, 'example.com', NOW).tone).toBe('muted')
    }
  })
})

describe('hostOf', () => {
  it('takes the host, port included', () => {
    expect(hostOf('https://example.com:8443/a/b')).toBe('example.com:8443')
  })

  it('hands back what it was given when that is not a URL', () => {
    expect(hostOf('nonsense')).toBe('nonsense')
  })
})
