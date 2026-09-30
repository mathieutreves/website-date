import { describe, expect, it } from 'vitest'
import { MAX_FETCHES_PER_PAGE } from '../lib/annotate.js'
import {
  FETCH_MESSAGE,
  fetchBudget,
  isFetchRequest,
  refusal,
  type FetchRequest,
  type RelayContext,
  type RelaySender,
} from '../lib/fetch-relay.js'

/**
 * The worker's fetch-for-the-annotator message is a fetch primitive in a
 * privileged context. These pin down who may use it and for what.
 */

const ID = 'pagedate-test'

const open: RelayContext = { extensionId: ID, fetchTier: true, granted: true }

const annotator: RelaySender = {
  id: ID,
  url: 'https://duckduckgo.com/?q=when+was+this+written',
  frameId: 0,
  tab: { id: 7 },
}

const ask = (url: string): FetchRequest => ({ type: FETCH_MESSAGE, url })

describe('who may ask', () => {
  it('accepts the annotator on a results page', () => {
    expect(refusal(ask('https://example.com/post'), annotator, open)).toBeNull()
  })

  it('refuses another extension', () => {
    expect(refusal(ask('https://example.com/'), { ...annotator, id: 'someone-else' }, open)).toBe('sender')
  })

  it('refuses a sender with no tab, which is an extension page and not a content script', () => {
    const { tab: _tab, ...pageless } = annotator
    expect(refusal(ask('https://example.com/'), pageless, open)).toBe('sender')
  })

  it('refuses a tab that is not showing a search engine', () => {
    for (const url of ['https://example.com/', 'https://google.phishing.example/search', undefined]) {
      expect(refusal(ask('https://example.com/'), { ...annotator, url }, open)).toBe('sender')
    }
  })

  it('refuses a subframe', () => {
    expect(refusal(ask('https://example.com/'), { ...annotator, frameId: 3 }, open)).toBe('sender')
  })
})

describe('what may be asked for', () => {
  it('refuses anything that is not http(s)', () => {
    for (const url of ['file:///etc/passwd', 'chrome://settings', 'data:text/html,x', 'ftp://example.com/']) {
      expect(refusal(ask(url), annotator, open), url).toBe('target')
    }
  })

  /*
   * A results page is attacker-influenced text. A link on it must not become a
   * request from inside the reader's network to something only they can reach.
   */
  it('refuses the private network', () => {
    for (const url of [
      'http://localhost:8080/',
      'http://127.0.0.1/',
      'http://192.168.0.1/admin',
      'http://169.254.169.254/latest/meta-data/',
      'http://[::1]/',
      'http://router/',
      'https://user:pass@example.com/',
    ]) {
      expect(refusal(ask(url), annotator, open), url).toBe('target')
    }
  })
})

describe('when', () => {
  it('refuses unless the fetch tier is switched on', () => {
    expect(refusal(ask('https://example.com/'), annotator, { ...open, fetchTier: false })).toBe('disabled')
  })

  it('refuses unless the all-sites grant is held', () => {
    expect(refusal(ask('https://example.com/'), annotator, { ...open, granted: false })).toBe('disabled')
  })
})

describe('recognising the message', () => {
  it('ignores everything that is not exactly this request', () => {
    expect(isFetchRequest(ask('https://example.com/'))).toBe(true)
    expect(isFetchRequest({ type: FETCH_MESSAGE })).toBe(false)
    expect(isFetchRequest({ type: 'other', url: 'https://example.com/' })).toBe(false)
    expect(isFetchRequest(null)).toBe(false)
    expect(isFetchRequest('pagedate:fetch-page')).toBe(false)
  })
})

describe('the per-page cap', () => {
  it('allows ten and refuses the eleventh', () => {
    const budget = fetchBudget()
    const taken = Array.from({ length: MAX_FETCHES_PER_PAGE + 1 }, () => budget.take(7))

    expect(taken.filter(Boolean)).toHaveLength(MAX_FETCHES_PER_PAGE)
    expect(taken.at(-1)).toBe(false)
  })

  it('counts each tab separately', () => {
    const budget = fetchBudget(1)
    expect(budget.take(1)).toBe(true)
    expect(budget.take(2)).toBe(true)
    expect(budget.take(1)).toBe(false)
  })

  it('starts again when the tab loads a new page', () => {
    const budget = fetchBudget(1)
    budget.take(1)
    budget.forget(1)
    expect(budget.take(1)).toBe(true)
  })
})
