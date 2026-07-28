/**
 * Fixture capture harness.
 *
 * Snapshots a live page plus the side documents the library consults, so the
 * heuristics can be developed and regression-tested offline.
 *
 *   pnpm fixture https://example.com/posts/thing
 *   pnpm fixture https://example.com/posts/thing --slug my-name
 *
 * Run with Node's native type stripping — no build step, no dependencies. The
 * regex HTML scraping below is deliberate: this is a dev script that must not
 * pull in a parser the library itself refuses to depend on.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const FIXTURES_DIR = join(import.meta.dirname, '..', 'fixtures')
const USER_AGENT =
  'Mozilla/5.0 (compatible; pagedate-fixture/0.1; +https://github.com/mathieu/website-date)'

function parseArgs(argv: string[]): { url: string; slug?: string } {
  const positional = argv.filter((a) => !a.startsWith('--'))
  const url = positional[0]
  if (!url) {
    console.error('usage: pnpm fixture <url> [--slug name]')
    process.exit(1)
  }

  const slugIndex = argv.indexOf('--slug')
  const slug = slugIndex >= 0 ? argv[slugIndex + 1] : undefined
  return slug ? { url, slug } : { url }
}

/** Stable, filesystem-safe directory name derived from the URL. */
function slugFor(url: URL): string {
  const path = url.pathname.replace(/\/+$/, '').replace(/^\/+/, '')
  const raw = `${url.hostname}${path ? `-${path}` : ''}`
  return (
    raw
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 80) || 'page'
  )
}

async function fetchWithHeaders(
  url: string,
): Promise<{ body: string; headers: Record<string, string>; status: number } | null> {
  try {
    const response = await fetch(url, {
      headers: { 'user-agent': USER_AGENT, accept: '*/*' },
      redirect: 'follow',
    })

    const headers: Record<string, string> = {}
    response.headers.forEach((value, key) => {
      headers[key] = value
    })

    return { body: await response.text(), headers, status: response.status }
  } catch (error) {
    console.warn(`  ! fetch failed for ${url}: ${(error as Error).message}`)
    return null
  }
}

/** Feed URL declared by the page, if any. */
function declaredFeed(html: string, base: URL): string | null {
  const linkTags = html.match(/<link\b[^>]*>/gi) ?? []

  for (const tag of linkTags) {
    if (!/rel\s*=\s*["'][^"']*\balternate\b/i.test(tag)) continue
    if (!/type\s*=\s*["']application\/(rss|atom)\+xml/i.test(tag)) continue

    const href = /href\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]
    if (!href) continue

    try {
      return new URL(href, base).toString()
    } catch {
      continue
    }
  }

  return null
}

/**
 * Detect client-side redirects, which `fetch` does not follow. Returns the
 * target when the body is a shim rather than an article.
 */
function looksLikeRedirectStub(html: string): string | null {
  if (html.length > 4096) return null

  const metaRefresh = /<meta[^>]+http-equiv\s*=\s*["']refresh["'][^>]*url=([^"'>\s]+)/i.exec(html)
  if (metaRefresh?.[1]) return metaRefresh[1]

  const jsRedirect = /(?:location\.replace|location\.href\s*=)\s*\(?\s*["']([^"']+)["']/i.exec(html)
  if (jsRedirect?.[1]) return jsRedirect[1]

  const jsTarget = /const\s+target\s*=\s*["']([^"']+)["']/i.exec(html)
  if (jsTarget?.[1] && /location\.replace/i.test(html)) return jsTarget[1]

  return null
}

async function main(): Promise<void> {
  const { url: rawUrl, slug: slugOverride } = parseArgs(process.argv.slice(2))

  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    console.error(`not a valid URL: ${rawUrl}`)
    process.exit(1)
  }

  const slug = slugOverride ?? slugFor(url)
  const dir = join(FIXTURES_DIR, slug)

  console.log(`capturing ${url.toString()}`)
  console.log(`  → fixtures/${slug}/`)

  const page = await fetchWithHeaders(url.toString())
  if (!page) {
    console.error('could not fetch the page; nothing written')
    process.exit(1)
  }
  if (page.status >= 400) {
    console.error(`page returned HTTP ${page.status}; nothing written`)
    process.exit(1)
  }

  const stub = looksLikeRedirectStub(page.body)
  if (stub) {
    // A 460-byte JS redirect shim is a valid HTTP 200 and would otherwise
    // become a silently useless fixture. Refuse rather than warn.
    console.error(`\nthis looks like a redirect stub, not the article: ${stub}`)
    console.error('re-run with the URL it points at; nothing written')
    process.exit(1)
  }

  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'page.html'), page.body)
  await writeFile(join(dir, 'headers.json'), `${JSON.stringify(page.headers, null, 2)}\n`)
  console.log(`  ✓ page.html (${(page.body.length / 1024).toFixed(0)} KB), headers.json`)

  // Feed: declared first, then the two well-known paths the library probes.
  const feedCandidates = [
    declaredFeed(page.body, url),
    new URL('/index.xml', url.origin).toString(),
    new URL('/feed.xml', url.origin).toString(),
  ].filter((v): v is string => Boolean(v))

  let feedUrl: string | null = null
  for (const candidate of feedCandidates) {
    const feed = await fetchWithHeaders(candidate)
    if (feed && feed.status < 400 && feed.body.trimStart().startsWith('<')) {
      await writeFile(join(dir, 'feed.xml'), feed.body)
      feedUrl = candidate
      console.log(`  ✓ feed.xml (from ${candidate})`)
      break
    }
  }
  if (!feedUrl) console.log('  – no feed found')

  const sitemapUrl = new URL('/sitemap.xml', url.origin).toString()
  const sitemap = await fetchWithHeaders(sitemapUrl)
  if (sitemap && sitemap.status < 400 && sitemap.body.trimStart().startsWith('<')) {
    await writeFile(join(dir, 'sitemap.xml'), sitemap.body)
    console.log(`  ✓ sitemap.xml`)
  } else {
    console.log('  – no sitemap found')
  }

  // Written only as a skeleton: the expectations are the human's judgement
  // about what the page actually means, which is the whole point of the corpus.
  const expected = {
    url: url.toString(),
    capturedAt: new Date().toISOString().slice(0, 10),
    notes: 'TODO: describe the site type and why this page is interesting',
    fetchedFeedUrl: feedUrl,
    expect: {
      published: null,
      modified: null,
      conflict: null,
    },
  }

  await writeFile(join(dir, 'expected.json'), `${JSON.stringify(expected, null, 2)}\n`)
  console.log(`  ✓ expected.json (skeleton)`)
  console.log(`\nNow fill in fixtures/${slug}/expected.json by hand.`)
}

await main()
