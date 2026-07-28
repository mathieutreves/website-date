/**
 * Harvest feed-labelled pages into the same corpus manifest.
 *
 *   node scripts/corpus/harvest-feed.ts
 *   node scripts/corpus/harvest-feed.ts --per-host 30 --seeds my-domains.txt
 *
 * Why a second label source at all: every `url-permalink` entry has its date in
 * the URL, so `url-slug` must be held out and the one thing we cannot measure is
 * what reading the URL is worth. A feed's `<pubDate>` is independent of the URL
 * entirely, so on this tier `url-slug` runs and can be scored honestly.
 *
 * **Feed labels are not independent of `<meta>`.** The feed and the page's
 * `article:published_time` usually come from the same CMS field, so this tier
 * flatters metadata extractors and cannot referee them. It is here to referee
 * the URL and text paths, which genuinely do not share provenance with it.
 * `holdOut` names only the feed channel; the caveat is the reader's to apply.
 *
 * Entries are pinned to a Wayback capture like every other tier — an article
 * with no capture is skipped rather than fetched live, because a corpus that is
 * reproducible except for one tier is not reproducible.
 */

import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import {
  archiveUrl,
  entryId,
  labelPrecedesCapture,
  readManifest,
  snapshotDay,
  writeFileAtomic,
  writeManifest,
  type CorpusEntry,
} from './schema.ts'

const ROOT = join(import.meta.dirname, '..', '..')
const OUT_DIR = join(ROOT, 'corpus')
const MANIFEST = join(OUT_DIR, 'manifest.jsonl')
const STATE = join(OUT_DIR, 'harvested-feeds.txt')
const USER_AGENT =
  'pagedate-corpus/0.1 (benchmark corpus construction; +https://github.com/mathieutreves/website-date)'

const require = createRequire(join(ROOT, 'packages', 'pagedate', 'package.json'))
const { parseHTML, DOMParser } = require('linkedom')

const { values } = parseArgs({
  options: {
    seeds: { type: 'string', default: join(import.meta.dirname, 'seeds.txt') },
    'per-host': { type: 'string', default: '25' },
    concurrency: { type: 'string', default: '3' },
  },
})

const PER_HOST = Number(values['per-host'])
const CONCURRENCY = Number(values.concurrency)

/** Conventional feed paths, tried when the homepage declares none. */
const FEED_PATHS = ['/feed', '/feed/', '/rss', '/rss.xml', '/atom.xml', '/index.xml', '/feed.xml']

async function get(url: string, timeoutMs = 30_000): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: { 'user-agent': USER_AGENT, accept: '*/*' },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    })
    return response.ok ? await response.text() : null
  } catch {
    return null
  }
}

/** The site's own declared feed, falling back to the usual paths. */
async function findFeed(host: string): Promise<string | null> {
  const origin = `https://${host.split('/')[0]}`
  const home = await get(origin)
  if (home) {
    try {
      const { document } = parseHTML(home)
      for (const link of document.querySelectorAll('link[rel~="alternate"]')) {
        const type = (link.getAttribute('type') ?? '').toLowerCase()
        const href = link.getAttribute('href')
        if (!href) continue
        if (type.includes('rss') || type.includes('atom') || type.includes('xml')) {
          return new URL(href, origin).toString()
        }
      }
    } catch {
      /* unparseable homepage */
    }
  }
  for (const path of FEED_PATHS) {
    const body = await get(origin + path)
    if (body && /<(rss|feed|rdf:RDF)[\s>]/i.test(body)) return origin + path
  }
  return null
}

type FeedItem = { url: string; date: string }

/** RSS `<item>` and Atom `<entry>`, which differ in both link and date element. */
function parseFeed(xml: string, base: string): FeedItem[] {
  let doc
  try {
    doc = new DOMParser().parseFromString(xml, 'text/xml')
  } catch {
    return []
  }
  const out: FeedItem[] = []

  const nodes = [...doc.querySelectorAll('item'), ...doc.querySelectorAll('entry')]
  for (const node of nodes) {
    // RSS puts the URL in <link>'s text; Atom puts it in href.
    const linkEl = node.querySelector('link')
    let href = linkEl?.getAttribute?.('href') ?? linkEl?.textContent?.trim() ?? ''
    if (!href) href = node.querySelector('guid')?.textContent?.trim() ?? ''
    if (!href) continue

    const raw =
      node.querySelector('pubDate')?.textContent ??
      node.querySelector('published')?.textContent ??
      node.querySelector('date')?.textContent ??
      node.querySelector('updated')?.textContent ??
      ''
    const parsed = Date.parse(raw.trim())
    if (!Number.isFinite(parsed)) continue

    try {
      out.push({
        url: new URL(href, base).toString(),
        date: new Date(parsed).toISOString().slice(0, 10),
      })
    } catch {
      /* unresolvable link */
    }
  }
  return out
}

/** Earliest capture of one exact URL, or null when the Archive has none. */
async function earliestCapture(url: string): Promise<string[] | null> {
  const query = new URL('https://web.archive.org/cdx/search/cdx')
  query.searchParams.set('url', url)
  query.searchParams.set('output', 'json')
  query.searchParams.set('limit', '1')
  query.searchParams.set('fl', 'original,timestamp,statuscode,mimetype,digest,length')
  query.searchParams.append('filter', 'statuscode:200')
  query.searchParams.append('filter', 'mimetype:text/html')

  const body = await get(query.toString(), 60_000)
  if (!body?.trim()) return null
  try {
    const rows = JSON.parse(body) as string[][]
    return rows.length > 1 ? rows[1] : null
  } catch {
    return null
  }
}

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true })

  const seeds = (await readFile(values.seeds!, 'utf8'))
    .split('\n')
    .map((l) => l.replace(/#.*$/, '').trim())
    .filter(Boolean)

  let existing: CorpusEntry[] = []
  try {
    existing = readManifest(await readFile(MANIFEST, 'utf8'))
  } catch {
    /* first run */
  }
  let attempted = new Set<string>()
  try {
    attempted = new Set((await readFile(STATE, 'utf8')).split('\n').map((l) => l.trim()).filter(Boolean))
  } catch {
    /* first run */
  }

  const seenUrls = new Set(existing.map((e) => e.url))
  const todo = seeds.filter((s) => !attempted.has(s))
  console.log(`${seeds.length} seeds, ${todo.length} to try for feeds`)

  const collected: CorpusEntry[] = []
  let index = 0

  const worker = async (): Promise<void> => {
    while (index < todo.length) {
      const seed = todo[index++]
      const host = seed.split('/')[0].replace(/^www\./, '')

      const feedUrl = await findFeed(seed)
      if (!feedUrl) {
        console.log(`  ${host.padEnd(26)} no feed`)
        await appendFile(STATE, `${seed}\n`)
        continue
      }
      const xml = await get(feedUrl)
      const items = xml ? parseFeed(xml, feedUrl) : []

      let kept = 0
      let noCapture = 0
      for (const item of items.slice(0, PER_HOST * 2)) {
        if (kept >= PER_HOST) break
        if (seenUrls.has(item.url)) continue

        const row = await earliestCapture(item.url)
        if (!row) {
          noCapture++
          continue
        }
        const [original, timestamp, statuscode, mimetype, digest, length] = row
        if (!labelPrecedesCapture(item.date, timestamp)) continue

        let entryHost: string
        try {
          entryHost = new URL(original).hostname.replace(/^www\./, '')
        } catch {
          continue
        }

        seenUrls.add(item.url)
        kept++
        collected.push({
          id: entryId(original),
          url: original,
          snapshot: timestamp,
          captureLagDays: Math.round(
            (Date.parse(`${snapshotDay(timestamp)}T00:00:00Z`) - Date.parse(`${item.date}T00:00:00Z`)) /
              86_400_000,
          ),
          archiveUrl: archiveUrl(timestamp, original),
          label: {
            published: item.date,
            precision: 'day',
            source: 'feed',
            tier: 'silver',
            evidence: `feed ${feedUrl}`,
          },
          // Only the feed channel shares provenance with this label. Meta tags
          // usually do too, via the CMS — see the note at the top of this file.
          holdOut: ['feed'],
          strata: {
            host: entryHost,
            tld: entryHost.slice(entryHost.lastIndexOf('.') + 1),
            era: Number(item.date.slice(0, 4)) || null,
          },
          http: { status: Number(statuscode), mime: mimetype, digest, length: Number(length) || 0 },
        })
      }

      console.log(
        `  ${host.padEnd(26)} ${String(kept).padStart(3)} kept from ${String(items.length).padStart(3)} items` +
          `${noCapture ? `  (${noCapture} not archived)` : ''}`,
      )
      await writeFileAtomic(MANIFEST, writeManifest([...existing, ...collected]))
      await appendFile(STATE, `${seed}\n`)
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  console.log(`\n${collected.length} feed-labelled entries added → corpus/manifest.jsonl`)
  console.log(`next: node scripts/corpus/fetch.ts && node scripts/corpus/enrich.ts`)
}

await main()
