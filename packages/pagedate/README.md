# pagedate

Extract publication and modification dates from web pages, with provenance and confidence. Browser-first, no runtime dependencies.

```bash
npm install pagedate
```

Most pages carry no visible date. Many that do show the original publication date while the content has been edited since. `pagedate` reports both dates, the source each came from, a confidence tier for each, and any contradiction between them.

## Output shape

```js
import { extractFromDocument, resolve } from 'pagedate'

const result = await resolve(
  extractFromDocument(document, location.href),
  location.href,
)

result.published  // { value: '2019-03-04', precision: 'day', confidence: 'declared', source: 'jsonld' }
result.modified   // { value: '2024-11-02', precision: 'day', confidence: 'derived',  source: 'sitemap' }
result.conflict   // { kind: 'stale-declaration', gapDays: 2070, detail: '…' }
result.candidates // everything found, unresolved, each with a note
```

Three properties follow from returning candidates rather than a single date:

- **Precision is not widened.** A page stating `2024` yields `{ value: '2024', precision: 'year' }`. If you need a full date, you decide how to fill it in.
- **Confidence is a tier, not a score.** `declared` — the site stated it in machine-readable metadata. `derived` — structured but weaker. `inferred` — taken from prose, a URL, or a transport header.
- **An empty result is a valid answer.** `minConfidence: 'declared'` restricts the answer to what the site itself claims, and may return nothing.

## Browser and extension use

No HTML parser is bundled; in a browser the DOM already exists.

```js
import { extractFromDocument, resolve } from 'pagedate'

const candidates = extractFromDocument(document, location.href)   // sync, no network
const result = await resolve(candidates, location.href)
```

Extraction is synchronous and DOM-only, so it can run in an MV3 content script. Resolution is where network-backed signals arrive, in the service worker.

## Node

```bash
npm install pagedate node-html-parser linkedom
```

Both are optional peer dependencies, needed only on this path.

```js
import { findDatesFromUrl, findDatesFromHtml } from 'pagedate/node'

await findDatesFromUrl('https://example.com/post')  // fetches, incl. feed and sitemap
await findDatesFromHtml(html, url)                   // offline
```

HTML is parsed by `node-html-parser`, roughly 2.5× faster than linkedom. XML is parsed by linkedom, loaded lazily so a caller who never reads a feed never needs it.

Outbound requests refuse private, loopback, link-local and cloud-metadata addresses, on every redirect hop, and response bodies are read with a size cap.

## Edge runtimes

```js
import { parse } from 'node-html-parser'
import { findDates, webEnv } from 'pagedate/edge'

const env = webEnv()
const html = await env.fetchText(url)
const result = await findDates(parse(html), url, env)
```

For Cloudflare Workers, Deno and Bun. Nothing on this path imports `node:` anything, and a test walks the import graph from the entry point to confirm it.

`webEnv` runs the same transport code as `nodeEnv` — same redirect walk, same timeout, same capped read — with the two Node-only pieces behind injection points. Two limits apply:

- **`blockPrivateNetwork: 'strict'` degrades to `'literal'`** unless you pass a `resolveHostname`, because there is no portable DNS resolver. The address filter still runs on every redirect hop; what is lost is the case of a public hostname resolving to a private address.
- **Cloudflare Workers has no `DOMParser`**, so feed and sitemap XML is skipped unless you pass `parseXml`. That costs the RSS, Atom and `<lastmod>` signals, which are the ones that make an undated static-site post solvable.

You bring your own HTML parser on every non-browser runtime.

## Staleness

```js
import { isStale, staleness } from 'pagedate'

const current = docs.filter((d) => !isStale(d.dates, { maxAgeDays: 365 }))

staleness(result, { maxAgeDays: 180 })
// { stale: false, reason: 'fresh', ageDays: 12, maxAgeDays: 12, basis: 'modified', used: {…} }
```

**Coarse precision is an interval, not a point.** A page stating "2024" could mean any instant in a 366-day window, and against a 180-day threshold that window has no answer. `staleness` reports `stale: null, reason: 'imprecise'` rather than picking a side, with `ageDays` and `maxAgeDays` bracketing the range.

**`basis` selects the question.** It defaults to `'either'` — the modification date when present, else publication. `'published'` asks when the page was written; `'modified'` asks whether it has been kept current.

`isStale` reduces this to a boolean for filtering, counting undecidable pages as stale by default. `whenUnknown: false` inverts it.

## CLI

```bash
npx pagedate https://example.com/post
npx pagedate --file page.html --url https://example.com/post --all
cat page.html | npx pagedate --url https://example.com/post --json
```

Exit codes: `0` a date was found, `1` none found, `2` the page could not be read.

### Batch

```bash
pagedate --batch --concurrency 8 < urls.txt > dated.ndjson
```

One URL per line, one JSON object per line out. Lines may instead be JSON objects with a `url` key, whose other keys are carried through to the output. Blank lines and `#` comments are skipped.

```
{"index":0,"url":"https://example.com/a","published":{…},"modified":null,"conflict":null}
{"docId":7,"index":3,"url":"https://example.com/b","error":"unreachable"}
```

- **Results stream as they finish, not in input order.** A pool preserving order would hold every completed result behind the slowest outstanding one. Every record carries its input line `index`.
- **Never more than one request per host**, whatever `--concurrency` says.
- **A failed page does not stop the run.** It gets a record with an `error` key and the pool moves on.

## MCP server

```jsonc
{ "mcpServers": { "pagedate": { "command": "npx", "args": ["-y", "pagedate-mcp"] } } }
```

[`pagedate-mcp`](../pagedate-mcp) exposes `page_freshness` and `page_date` to an agent. It is a separate package because this one has no runtime dependencies and an MCP server requires some.

## Options

```js
extractFromDocument(document, url, {
  mode: 'standard',          // 'fast' | 'standard' (default) | 'extensive'
  dayFirst: 'day-first',     // override the DD/MM vs MM/DD heuristic
  minConfidence: 'declared', // ignore anything the site did not state itself
})
```

| mode | accuracy | ms/page | reads |
| --- | --- | --- | --- |
| `fast` | 68.8% | 0.9 | declared metadata only — JSON-LD, OpenGraph, `<time>`, URL |
| `standard` | 90.9% | 3.2 | the above plus rendered text and inlined CMS state |
| `extensive` | 90.9% | 4.2 | the above plus unlabelled text, always |

`extensive` finds the same 230 correct answers as `standard` on the held-out split and turns one abstention into a wrong answer. Its function is populating `candidates` for conflict detection and for display; it will date a page that has no date.

Accuracy is the held-out split described below. ms/page is extraction only, which is the whole cost in a browser and none of the parsing cost in Node.

### Network signals

```js
await findDatesFromUrl(url, {
  sitemap: true,      // default. Looks the page up in the site's sitemap.
  httpHeaders: false, // default. Reads Last-Modified from the response headers.
})
```

Feed entries (`<published>`, `<updated>`, `<pubDate>`) are `declared` and always looked for. Sitemap `<lastmod>` reports `modified`, and is ignored when every entry shares one timestamp, which indicates a build stamp. HTTP `Last-Modified` is off by default, because behind a CDN it is the serve time.

## Conflicts

`published` and `modified` merely differing is not a conflict. Three things are:

- **`declared-disagreement`** — two things the site declared for the same field differ by more than 30 days.
- **`predated-content`** — the page carries several machine-readable timestamps older than the date it claims, indicating a republication stamp rather than a writing date.
- **`stale-declaration`** — a publication date long predates archive evidence of edits the page does not show.

## Languages

Around 25 languages of month names, non-ASCII digit systems (Arabic, Persian, Devanagari, Thai, full-width), CJK structural dates (`2024年3月12日`), and ordinal suffixes in English, French, Spanish and Dutch. Ambiguous all-numeric dates degrade to month precision.

## Accuracy

On a 253-page held-out split of a corpus built for this project — 1248 pages, 33 hosts, 10 languages, labels from dated URL permalinks, hosts assigned to dev and test by hash, URL neutralised for every tool, and `htmldate` invoked with `original_date=True`:

| tool | precision | accuracy |
| --- | ---: | ---: |
| htmldate (extensive) | 93.3% | 93.3% |
| pagedate (standard) | 94.2% | 89.3% |
| htmldate (fast) | 95.2% | 85.8% |
| metascraper | 81.3% | 70.4% |
| articleDateExtractor | 93.1% | 69.6% |
| pagedate (fast) | 95.0% | 67.2% |
| newspaper4k | 97.1% | 65.6% |
| goose3 | 98.7% | 61.3% |
| @extractus/article-extractor | 79.9% | 54.9% |
| unfluff | 98.4% | 49.4% |

[htmldate](https://github.com/adbar/htmldate) leads by 4.0 points and answers every page. pagedate is second, marginally ahead on precision, at roughly a quarter of the per-page cost. On htmldate's own German-news corpus the margin widens to 29 points; it is the better general-purpose extractor on news, and what this library offers is a different shape that runs where htmldate cannot.

Read both columns. Every page in this corpus has a date, so declining to answer can only cost accuracy. pagedate declines on 13 pages, htmldate on none, and those 13 are 5.1 points against a 4.0-point deficit. Whether that trade suits you is the reason the library reports a confidence tier rather than a number.

On the dev split — the one the extraction rules were developed against — pagedate scores 96.0%. Quote the held-out figure.

Full tables, the corpus construction, and what was tried and rejected: [docs/BENCHMARK.md](https://github.com/mathieutreves/website-date/blob/main/docs/BENCHMARK.md). Everything is reproducible with `./scripts/validate.sh`.

## Status

`0.x`. The API may still change. Published and modified dates, provenance, confidence tiers, conflict detection, staleness, the Node and edge entry points and the CLI all work and are covered by 303 tests.

## Licence

MIT. Portions adapted from [htmldate](https://github.com/adbar/htmldate) (Apache-2.0) — see [NOTICE](./NOTICE).
