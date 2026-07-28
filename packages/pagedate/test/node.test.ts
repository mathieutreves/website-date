import { describe, expect, it } from 'vitest'
import { findDatesFromHtml, nodeEnv, parseHtml } from '../src/node/index.js'
import { NOW } from './helpers.js'

const URL_ = 'https://example.com/posts/thing'

describe('parseHtml', () => {
  it('produces a Document the extractors can read', () => {
    const doc = parseHtml(`<html><head><title>x</title></head><body><p>hi</p></body></html>`)
    expect(doc.querySelector('p')?.textContent).toBe('hi')
  })
})

describe('findDatesFromHtml', () => {
  it('extracts from a string with no network access', async () => {
    const result = await findDatesFromHtml(
      `<html><head>
        <meta property="article:published_time" content="2023-04-11T10:00:00Z">
       </head><body><article><p>Body.</p></article></body></html>`,
      URL_,
      { now: NOW },
    )

    expect(result.published?.value).toBe('2023-04-11T10:00Z')
    expect(result.published?.confidence).toBe('declared')
  })

  it('skips the feed path entirely when no env is given', async () => {
    // Declaring a feed must not cause a fetch when the caller opted out of
    // network access — offline has to mean offline.
    const result = await findDatesFromHtml(
      `<html><head><link rel="alternate" type="application/atom+xml" href="/index.xml"></head>
       <body><article><p>No date.</p></article></body></html>`,
      URL_,
      { now: NOW },
    )

    expect(result.candidates).toEqual([])
  })

  it('uses a supplied env for feed lookup', async () => {
    const feed = `<feed xmlns="http://www.w3.org/2005/Atom"><entry>
      <link href="${URL_}"/><published>2023-04-11T00:00:00Z</published>
    </entry></feed>`

    const env = nodeEnv()
    // Replace only the fetcher; the real XML parser stays in play.
    env.fetchText = async (url) => (url.endsWith('/index.xml') ? feed : null)

    const result = await findDatesFromHtml(
      `<html><head><link rel="alternate" type="application/atom+xml" href="/index.xml"></head>
       <body><article><p>No date.</p></article></body></html>`,
      URL_,
      { env, now: NOW },
    )

    expect(result.published?.value).toBe('2023-04-11T00:00Z')
    expect(result.published?.source).toBe('atom-feed')
  })
})

describe('nodeEnv', () => {
  it('parses XML without a global DOMParser', () => {
    // Node has none; the Node entry supplies linkedom's.
    const doc = nodeEnv().parseXml?.(`<feed><entry><title>x</title></entry></feed>`)
    expect(doc?.querySelector('title')?.textContent).toBe('x')
  })

  it('returns null instead of throwing when a request fails', async () => {
    // A missing feed is a normal condition, not an error worth aborting on.
    const env = nodeEnv({ timeoutMs: 1 })
    await expect(env.fetchText?.('http://127.0.0.1:1/nope')).resolves.toBeNull()
  })

  it('honours an injected clock', () => {
    const fixed = new Date('2020-01-01T00:00:00Z')
    expect(nodeEnv({ now: () => fixed }).now?.()).toEqual(fixed)
  })
})
