# website-date

Find out when a web page was *actually* written — and when it was quietly rewritten since.

Most pages don't show a date. Many that do show the original publication date while the content has been edited for years. This project detects both, reports **where each date came from** and **how much to trust it**, and flags the case where a site contradicts itself.

Two pieces:

- **`pagedate`** — a zero-dependency, browser-first library. Takes a `Document`, returns date candidates with provenance and confidence.
- **A browser extension** (Chrome + Firefox, MV3 via WXT) that renders the result on demand.

## Status

Library, CLI and extension all work. Not published to npm or the extension
stores yet.

On the local corpus of 17 annotated pages: **100%** published accuracy, **94.1%**
modified. On [htmldate](https://github.com/adbar/htmldate)'s public cached
subset: **63.6%** — second of ten tools measured, and first among JavaScript
ones. See [Against other tools](#against-other-tools).

## Usage

### In a browser or extension content script

Zero dependencies, no HTML parser bundled — the DOM already exists.

```js
import { extractFromDocument, resolve } from 'pagedate'

const candidates = extractFromDocument(document, location.href)
const result = await resolve(candidates, location.href)

result.published // { value: '2023-04-11', confidence: 'declared', source: 'jsonld', ... }
result.conflict  // set when the page contradicts itself
```

### In Node

`linkedom` is an optional peer dependency, needed only for this path.

```bash
pnpm add pagedate linkedom
```

```js
import { findDatesFromUrl, findDatesFromHtml } from 'pagedate/node'

await findDatesFromUrl('https://example.com/post')   // fetches, incl. feed and sitemap
await findDatesFromHtml(html, url)                    // offline
```

### Options

```js
extractFromDocument(document, url, {
  mode: 'fast',              // 'fast' | 'standard' (default) | 'extensive'
  dayFirst: 'day-first',     // override the DD/MM vs MM/DD heuristic
  minConfidence: 'declared', // ignore anything the site did not state itself
})
```

Text scanning is ~80% of extraction cost, so `mode` is the main performance lever:

| mode | ms/page | correct, modern sites | correct, metadata-poor sites |
|---|---|---|---|
| `fast` | 1.3 | 16 / 17 | 12 / 55 |
| `standard` | 4.9 | 17 / 17 | 35 / 55 |
| `extensive` | 5.3 | 16 / 17 | 35 / 55 |

`fast` reads declared metadata only. It costs almost nothing on sites that emit
JSON-LD or OpenGraph — which is most of them — and is the right choice when
checking every page rather than one on demand. It is blind to pages whose date
exists only in prose.

`extensive` does **not** improve accuracy; it was measured and does not. It
exists to populate `candidates` for conflict detection and for showing a reader
everything a page contains.

`minConfidence: 'declared'` answers "what does this site actually claim", with
no inference at all — including returning nothing.

### Network signals

`findDates` and the Node helpers can also ask the site about the page, rather
than only the page about itself. Each costs at least one request, so each is a
decision:

```js
await findDatesFromUrl(url, {
  sitemap: true,      // default. Looks the page up in the site's sitemap.
  httpHeaders: false, // default. Reads Last-Modified from the response headers.
})
```

**Feed** entries (`<published>`, `<updated>`, `<pubDate>`) are `declared` and
always looked for — they are what makes an undated static-site post solvable.

**Sitemap `<lastmod>`** is `derived`, and reports `modified` rather than
`published`, because that is what `<lastmod>` means. It is skipped when the page
already declares a modification date, and ignored entirely when every entry in
the sitemap carries the same timestamp — that is a build stamp, not a fact about
any page. It is what lets the library answer a hand-written page with no date
anywhere in its markup.

**HTTP `Last-Modified`** is off by default and that is a measured decision, not
a cautious one: behind a CDN it is the serve time, and on the local corpus it
invented two edits and found nothing new. Responses that set a cookie, forbid
caching, or stamp `Last-Modified` within five minutes of their own `Date` are
discarded before the rest is even considered. See
[§4.10 of the design doc](docs/DESIGN.md#410-transport-signals--http-last-modified).

### CLI

```bash
npx pagedate https://example.com/post
npx pagedate --file page.html --url https://example.com/post --all
cat page.html | npx pagedate --url https://example.com/post --json
npx pagedate --headers --no-sitemap https://example.com/post
```

Exit codes: `0` a date was found, `1` none found, `2` the page could not be read.

## Evaluation

```bash
pnpm test                                    # unit tests + local corpus metrics
node scripts/fetch-htmldate-corpus.ts        # download the external corpus
node packages/pagedate/scripts/eval-htmldate.ts
```

The local corpus reports precision/recall/accuracy/F-score in the same shapes htmldate publishes, plus two things a single-date benchmark cannot express: **true negatives** (pages that genuinely have no date, where returning nothing is correct) and **confidence-tier calibration** (if `declared` and `inferred` are right equally often, the tiering is decorative).

### Against other tools

Measured on the same pages, current versions — see [docs/BENCHMARK.md](docs/BENCHMARK.md):

| tool | accuracy | ms/page |
|---|---|---|
| htmldate (extensive) | 90.9% | 75.5 |
| htmldate (fast) | 78.2% | 11.2 |
| **pagedate (standard)** | **63.6%** | **5.4** |
| date_guesser | 25.5% | 115.6 |
| newspaper4k | 20.0% | 148.8 |
| @extractus/article-extractor | 14.5% | 85.5 |
| unfluff | 14.5% | 114.0 |
| goose3 | 7.3% | 131.8 |

htmldate is the better general-purpose extractor and it is not close. What
pagedate offers is a different shape: it runs in a browser where htmldate
cannot, it is the fastest of the group, and among JavaScript libraries nothing
else is within 3.5x of it. It also reports published *and* modified dates with
provenance and conflict detection, none of which this benchmark measures.

Note htmldate's published 1000-page benchmark is **not** reproducible — only ~55
annotated cached pages are in their public repo, and they are also that project's
unit-test set. Every non-htmldate figure here is likely understated as a result.

## Adding fixtures

```bash
node scripts/fixture.ts https://example.com/post
```

Snapshots the page, headers, feed and sitemap, then writes an `expected.json` skeleton to fill in by hand. That judgement about what a page actually means is the corpus.

## Design

See [docs/DESIGN.md](docs/DESIGN.md) — architecture, signal ladder, resolution algorithm, build phases, and the decision log.

## Why not just use an existing library?

Several extract dates. None are browser-first with zero deps, expose published and modified as distinct outputs, *and* carry a confidence/provenance field. That last one is what makes the output actionable rather than just another number on the screen. Prior art is surveyed in [§1 of the design doc](docs/DESIGN.md#1-context).
