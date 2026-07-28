# pagedate

Extract publication and modification dates from web pages, **with provenance and confidence**. Browser-first, zero runtime dependencies.

```bash
npm install pagedate
```

Most pages don't show a date. Many that do show the original publication date while the content has been edited for years. `pagedate` reports both dates, where each came from, how much to trust it, and flags the case where a page contradicts itself.

## Why not just return a date

Every other library in this space returns *a date*. The interesting cases can't be expressed as one:

```js
import { extractFromDocument, resolve } from 'pagedate'

const result = await resolve(
  extractFromDocument(document, location.href),
  location.href,
)

result.published  // { value: '2019-03-04', precision: 'day', confidence: 'declared', source: 'jsonld' }
result.modified   // { value: '2024-11-02', precision: 'day', confidence: 'derived',  source: 'sitemap' }
result.conflict   // { kind: 'stale-declaration', gapDays: 2070, detail: '…' }
result.candidates // everything found, unresolved, each with a note explaining it
```

Three consequences worth knowing before you depend on it:

**Precision is never inflated.** A page that says `2024` yields `{ value: '2024', precision: 'year' }`, not a fabricated January 1st. If you need a full date, you decide how to fill it in — the library won't pretend it knows.

**Confidence is a tier, not a score.** `declared` — the site stated it in machine-readable metadata. `derived` — structured but weaker. `inferred` — guessed from prose, a URL, or a transport header.

**Returning nothing is a valid answer.** `minConfidence: 'declared'` answers "what does this site actually claim" and will happily return nothing at all.

## Browser and extension use

Zero dependencies, and no HTML parser is bundled — in a browser the DOM already exists.

```js
import { extractFromDocument, resolve } from 'pagedate'

const candidates = extractFromDocument(document, location.href)   // sync, no network
const result = await resolve(candidates, location.href)
```

The split is deliberate: extraction is synchronous and DOM-only so it can run in an MV3 content script, while resolution is where network-backed signals arrive, in the service worker.

## Node

```bash
npm install pagedate node-html-parser linkedom
```

Both are optional peer dependencies, needed only for this path.

```js
import { findDatesFromUrl, findDatesFromHtml } from 'pagedate/node'

await findDatesFromUrl('https://example.com/post')  // fetches, incl. feed and sitemap
await findDatesFromHtml(html, url)                   // offline
```

Two parsers for two jobs. HTML goes through `node-html-parser` (~2.5× faster than linkedom); XML through linkedom, loaded lazily so a caller who never touches a feed never needs it. `<link>` is a void element in HTML but not in RSS, so an HTML parser reading a feed silently empties every `<link>` it meets.

Outbound requests refuse private, loopback, link-local and cloud-metadata addresses — on every redirect hop, not just the first — and response bodies are read with a size cap.

## CLI

```bash
npx pagedate https://example.com/post
npx pagedate --file page.html --url https://example.com/post --all
cat page.html | npx pagedate --url https://example.com/post --json
```

Exit codes: `0` a date was found, `1` none found, `2` the page could not be read.

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
| `fast` | 59.9% | 4.2 | declared metadata only — JSON-LD, OpenGraph, `<time>`, URL |
| `standard` | 89.7% | 4.4 | the above plus rendered text and inlined CMS state |
| `extensive` | 89.7% | 4.3 | the above plus unlabelled text, always |

`extensive` does **not** improve accuracy — measured repeatedly, it does not. It exists to populate `candidates` for conflict detection and for showing a reader everything a page contains. Those figures are the dev split; see the accuracy note below.

### Network signals

```js
await findDatesFromUrl(url, {
  sitemap: true,      // default. Looks the page up in the site's sitemap.
  httpHeaders: false, // default. Reads Last-Modified from the response headers.
})
```

Feed entries (`<published>`, `<updated>`, `<pubDate>`) are `declared` and always looked for — this is what makes an undated static-site post solvable at all. Sitemap `<lastmod>` reports `modified`, because that is what it means, and is ignored when every entry shares one timestamp (a build stamp, not a fact about any page). HTTP `Last-Modified` is off by default because behind a CDN it is the serve time.

## Conflicts

`published` and `modified` merely differing is normal and deliberately **not** a conflict — that distinction is what stops the flag being permanently lit and therefore ignored. Three things are:

- **`declared-disagreement`** — two things the site declared for the same field differ by more than 30 days.
- **`predated-content`** — the page carries several machine-readable timestamps *older* than the date it claims. Readers cannot comment on an article before it exists, so this is a republication stamp rather than a writing date.
- **`stale-declaration`** — a publication date long predates archive evidence of edits the page does not show.

## Languages

Around 25 languages of month names, non-ASCII digit systems (Arabic, Persian, Devanagari, Thai, full-width), CJK structural dates (`2024年3月12日`), and ordinal suffixes in English, French, Spanish and Dutch. Ambiguous all-numeric dates degrade to month precision rather than guessing.

## How accurate is it, really

On a 90-page **held-out** split of a corpus built for this project — labels from dated URL permalinks, URL neutralised for every tool:

| tool | accuracy |
| --- | ---: |
| htmldate (extensive) | 82.2% |
| **pagedate (standard)** | **76.7%** |
| htmldate (fast) | 76.7% |
| metascraper | 66.7% |
| articleDateExtractor | 61.1% |
| @extractus/article-extractor | 58.9% |
| unfluff | 42.2% |

On the **dev** split — the one the library was tuned against — pagedate scores 89.7% and leads the field. That lead does not survive the held-out split, and the dev figure should not be quoted. [htmldate](https://github.com/adbar/htmldate) is the better general-purpose extractor; what this offers is a different shape, and it runs where htmldate cannot.

Full tables, the corpus construction, and what was tried and rejected: [docs/BENCHMARK.md](https://github.com/mathieutreves/website-date/blob/main/docs/BENCHMARK.md). Everything is reproducible with `./scripts/validate.sh`.

## Status

`0.x`. The API may still change. Published and modified dates, provenance, confidence tiers and conflict detection all work and are covered by 235 tests.

## Licence

MIT. Portions adapted from [htmldate](https://github.com/adbar/htmldate) (Apache-2.0) — see [NOTICE](./NOTICE).
