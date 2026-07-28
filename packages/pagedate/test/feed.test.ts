import { describe, expect, it } from 'vitest'
import { findDates } from '../src/index.js'
import { extractFeed } from '../src/extract/feed.js'
import { documentFrom, NOW, strictEnv } from './helpers.js'

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>Another post</title>
    <link href="https://blog.example.com/posts/other/"/>
    <published>2022-01-05T00:00:00Z</published>
    <updated>2022-01-05T00:00:00Z</updated>
  </entry>
  <entry>
    <title>The post</title>
    <link href="https://blog.example.com/posts/the-post/"/>
    <published>2023-04-11T00:00:00Z</published>
    <updated>2025-02-18T00:00:00Z</updated>
  </entry>
</feed>`

const RSS = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <item>
    <title>The post</title>
    <link>https://blog.example.com/posts/the-post/</link>
    <pubDate>Tue, 11 Apr 2023 09:00:00 GMT</pubDate>
  </item>
</channel></rss>`

const PAGE_URL = 'https://blog.example.com/posts/the-post/'

describe('feed extraction', () => {
  it('reads published and updated from a declared Atom feed', async () => {
    const doc = documentFrom(`
      <html><head>
        <link rel="alternate" type="application/atom+xml" href="/index.xml">
      </head><body><article><p>No date anywhere.</p></article></body></html>`)

    const found = await extractFeed(
      doc,
      new URL(PAGE_URL),
      strictEnv({ text: { 'https://blog.example.com/index.xml': ATOM } }),
    )

    expect(found).toHaveLength(2)
    expect(found.find((c) => c.field === 'published')?.value).toBe('2023-04-11T00:00Z')
    expect(found.find((c) => c.field === 'modified')?.value).toBe('2025-02-18T00:00Z')
    expect(found.every((c) => c.confidence === 'declared')).toBe(true)
    expect(found[0]?.source).toBe('atom-feed')
  })

  it('picks the entry matching the page, not the first one', async () => {
    const doc = documentFrom(
      `<link rel="alternate" type="application/atom+xml" href="/index.xml">`,
    )

    const found = await extractFeed(
      doc,
      new URL('https://blog.example.com/posts/other/'),
      strictEnv({ text: { 'https://blog.example.com/index.xml': ATOM } }),
    )

    expect(found.find((c) => c.field === 'published')?.value).toBe('2022-01-05T00:00Z')
  })

  it('reads RSS pubDate as published only', async () => {
    const doc = documentFrom(`<link rel="alternate" type="application/rss+xml" href="/rss.xml">`)

    const found = await extractFeed(
      doc,
      new URL(PAGE_URL),
      strictEnv({ text: { 'https://blog.example.com/rss.xml': RSS } }),
    )

    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({
      value: '2023-04-11T09:00Z',
      field: 'published',
      source: 'rss-feed',
    })
  })

  it('treats an Atom entry with only <updated> as a publication date', async () => {
    // Inventing an edit history the post does not have would be worse than
    // reporting the one date it actually states.
    const feed = `<feed xmlns="http://www.w3.org/2005/Atom"><entry>
      <link href="${PAGE_URL}"/><updated>2023-04-11T00:00:00Z</updated>
    </entry></feed>`

    const doc = documentFrom(`<link rel="alternate" type="application/atom+xml" href="/index.xml">`)
    const found = await extractFeed(
      doc,
      new URL(PAGE_URL),
      strictEnv({ text: { 'https://blog.example.com/index.xml': feed } }),
    )

    expect(found).toHaveLength(1)
    expect(found[0]?.field).toBe('published')
    expect(found[0]?.note).toContain('only <updated>')
  })

  it('probes well-known paths when the page declares no feed', async () => {
    const doc = documentFrom(`<html><body><p>Nothing here.</p></body></html>`)

    const found = await extractFeed(
      doc,
      new URL(PAGE_URL),
      strictEnv({ text: { 'https://blog.example.com/index.xml': ATOM } }),
    )

    expect(found.find((c) => c.field === 'published')?.value).toBe('2023-04-11T00:00Z')
    expect(found[0]?.note).toContain('probed')
  })

  it('matches on path when the feed URL carries different query parameters', async () => {
    const feed = `<feed xmlns="http://www.w3.org/2005/Atom"><entry>
      <link href="https://blog.example.com/posts/the-post/?utm_source=rss"/>
      <published>2023-04-11T00:00:00Z</published>
    </entry></feed>`

    const doc = documentFrom(`<link rel="alternate" type="application/atom+xml" href="/index.xml">`)
    const found = await extractFeed(
      doc,
      new URL(PAGE_URL),
      strictEnv({ text: { 'https://blog.example.com/index.xml': feed } }),
    )

    expect(found[0]?.value).toBe('2023-04-11T00:00Z')
  })
})

describe('feed integration', () => {
  it('rescues an undated static-site post end to end', async () => {
    // The motivating case: a Hugo post with no inline metadata at all.
    const doc = documentFrom(`
      <html lang="en"><head>
        <link rel="alternate" type="application/atom+xml" href="/index.xml">
      </head><body>
        <article><h1>The post</h1><p>Body text with no date.</p></article>
      </body></html>`)

    const result = await findDates(
      doc,
      PAGE_URL,
      strictEnv({ text: { 'https://blog.example.com/index.xml': ATOM } }),
      { now: NOW },
    )

    expect(result.published?.value).toBe('2023-04-11T00:00Z')
    expect(result.published?.confidence).toBe('declared')
    expect(result.modified?.value).toBe('2025-02-18T00:00Z')
  })

  it('degrades cleanly when no fetcher is available', async () => {
    const doc = documentFrom(`
      <link rel="alternate" type="application/atom+xml" href="/index.xml">`)

    // No env at all — the DOM-only path must still work and must not throw.
    const result = await findDates(doc, PAGE_URL, {}, { now: NOW })
    expect(result.candidates).toEqual([])
  })
})
