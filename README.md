# website-date

Determines when a web page was published, and whether it has been modified since.

Most pages carry no visible date. Many that do show the original publication date while the content has been edited for years. This project reports both dates, the source each was taken from, a confidence tier for each, and any contradiction between them.

Two pieces:

- **`pagedate`** — a browser-first library with no runtime dependencies. Takes a `Document`, returns date candidates with provenance and confidence.
- **A browser extension** for Chrome and Firefox, MV3 via WXT, that renders the result on demand.

## Status

The library, CLI, MCP server and extension are implemented and tested. Nothing is published to npm or to either extension store.

| | |
| --- | --- |
| Library tests | 303 passing |
| Extension tests | 273 passing |
| MCP server tests | 16 passing |
| Annotated fixtures | 17 pages, 8 languages |
| Benchmark corpus | 1248 pages, 33 hosts, 10 languages, 2005–2026 |
| Published-date accuracy, held-out split | 90.9% |
| Runtime dependencies | none |

Parts of this codebase were written with AI assistance. Every corpus label records the source it was derived from, under the rules in [docs/CORPUS-BUILD.md](docs/CORPUS-BUILD.md), and every number above is regenerated from committed inputs by `./scripts/validate.sh`.

## Output shape

```js
result.published  // { value: '2019-03-04', confidence: 'declared', source: 'jsonld' }
result.modified   // { value: '2024-11-02', confidence: 'derived',  source: 'sitemap' }
result.conflict   // { kind: 'stale-declaration', gapDays: 2070, detail: '…' }
result.candidates // everything found, unresolved, each with a note
```

Three properties follow from returning candidates rather than a single date:

- **Precision is not widened.** A page that states "2024" yields `{ value: '2024', precision: 'year' }`. No January 1st is supplied.
- **Confidence is a tier, not a score.** `declared` means the site stated it in machine-readable metadata; `derived` means structured but weaker; `inferred` means taken from prose, a URL, or a transport header. `minConfidence: 'declared'` restricts the answer to what the site itself claims, and may return nothing.
- **An empty answer is a valid answer.** Five of the 17 fixtures have no publication date, and the fixture suite scores true negatives. Neither benchmark corpus can: every page in each has a determinable date, so a false positive is unmeasurable there.

## Install and use

### Browser and extension content scripts

No HTML parser is bundled; in a browser the DOM already exists.

```js
import { extractFromDocument, resolve } from 'pagedate'

const candidates = extractFromDocument(document, location.href)
const result = await resolve(candidates, location.href)
```

### Node

`node-html-parser` and `linkedom` are optional peer dependencies, required only on this path.

```bash
pnpm add pagedate node-html-parser linkedom
```

```js
import { findDatesFromUrl, findDatesFromHtml } from 'pagedate/node'

await findDatesFromUrl('https://example.com/post')  // fetches, incl. feed and sitemap
await findDatesFromHtml(html, url)                   // offline
```

HTML is parsed by `node-html-parser`, roughly 2.5× faster than linkedom. XML is parsed by linkedom, loaded only when a feed or sitemap is read.

### Cloudflare Workers, Deno, Bun

```js
import { parse } from 'node-html-parser'
import { findDates, webEnv } from 'pagedate/edge'

const env = webEnv()
const result = await findDates(parse(await env.fetchText(url)), url, env)
```

Nothing reachable from `pagedate/edge` imports `node:` anything; `test/edge.test.ts` walks the import graph from the entry point and fails on any such import.

`webEnv` runs the same transport code as `nodeEnv`. Two limits apply on these runtimes:

- `blockPrivateNetwork: 'strict'` degrades to `'literal'` without a `resolveHostname`. The address filter still runs on every redirect hop; the resolution preflight is lost, so a public hostname resolving to a private address is not caught.
- Cloudflare Workers has no `DOMParser`, so feed and sitemap XML is skipped unless `parseXml` is supplied. Those are the signals that make an undated static-site post solvable.

### Staleness

```js
import { isStale, staleness } from 'pagedate'

const current = docs.filter((d) => !isStale(d.dates, { maxAgeDays: 365 }))
```

`staleness` compares intervals rather than points. A page stating "2024" refers to some instant in a 366-day window; against a 180-day threshold part of that window is stale and part is not, and the result is `{ stale: null, reason: 'imprecise' }`, with `ageDays` and `maxAgeDays` bracketing the range.

`basis` selects the question. It defaults to `'either'` — the modification date when present, otherwise publication. `'published'` asks when the page was written; `'modified'` asks whether it has been kept current.

`isStale` reduces this to a boolean and counts an undecidable page as stale. `whenUnknown: false` inverts that.

### CLI

```bash
npx pagedate https://example.com/post
npx pagedate --file page.html --url https://example.com/post --all
cat page.html | npx pagedate --url https://example.com/post --json
```

Exit codes: `0` a date was found, `1` none found, `2` the page could not be read.

Batch mode takes one URL per line and emits one JSON object per line:

```bash
pagedate --batch --concurrency 8 < urls.txt > dated.ndjson
```

```
{"index":0,"url":"https://example.com/a","published":{…},"modified":null,"conflict":null}
{"docId":7,"index":3,"url":"https://example.com/b","error":"unreachable"}
```

An input line may instead be a JSON object with a `url` key; its other keys are carried through to the output, and pagedate's own keys win a collision. Blank lines and `#` comments are skipped.

- Results stream as they complete, not in input order. Every record carries its input line `index`.
- At most one request per host is in flight, whatever `--concurrency` is set to.
- A page that fails receives an `error` key; the run continues.

### MCP server

```jsonc
{ "mcpServers": { "pagedate": { "command": "npx", "args": ["-y", "pagedate-mcp"] } } }
```

[`pagedate-mcp`](packages/pagedate-mcp) exposes `page_freshness` and `page_date`. It is a separate package because `pagedate` has no runtime dependencies and an MCP server requires some.

Its tools return a text rendering alongside the structured result. The text carries the provenance and confidence tier, and `UNDETERMINED` states that absence of a date is not evidence that a page is recent.

`blockPrivateNetwork` defaults to `'strict'` there rather than the library's `'literal'`.

### Options

```js
extractFromDocument(document, url, {
  mode: 'standard',          // 'fast' | 'standard' (default) | 'extensive'
  dayFirst: 'day-first',     // override the DD/MM vs MM/DD heuristic
  minConfidence: 'declared', // ignore anything the site did not state itself
})
```

Text scanning is most of the extraction cost, so `mode` is the main performance control. Accuracy is on the held-out split; time is extraction only, which is the whole cost in a browser.

| mode | accuracy | ms/page | reads |
| --- | --- | --- | --- |
| `fast` | 68.8% | 0.9 | declared metadata only — JSON-LD, OpenGraph, `<time>`, URL |
| `standard` | 90.9% | 3.2 | the above plus rendered text and inline state |
| `extensive` | 90.9% | 4.2 | the above plus unlabelled text, always |

`extensive` finds the same 230 correct answers as `standard` on the held-out split and converts one abstention into a wrong answer: 17 wrong and 6 missed against 16 and 7. On the 55-page htmldate corpus it scores 69.1% against `standard`'s 67.3%, a difference of one page. Its function is populating `candidates` for conflict detection and for display.

`fast` costs 22.1 points of accuracy and saves about 2.3 ms per page. In an extension the DOM already exists, so that is the entire saving. In Node the caller also pays 8–11 ms to parse the HTML, so `fast` moves a page from roughly 14 ms to 10 ms.

Timings are medians over repeated passes, taken after every mode has been warmed, with the order rotated between rounds. See `packages/pagedate/scripts/modes.ts`.

### Network signals

`findDates` and the Node helpers can query the site about the page. Each costs at least one request.

```js
await findDatesFromUrl(url, {
  sitemap: true,      // default. Looks the page up in the site's sitemap.
  httpHeaders: false, // default. Reads Last-Modified from the response headers.
})
```

- **Feeds** (`<published>`, `<updated>`, `<pubDate>`) are `declared` and always looked for.
- **Sitemap `<lastmod>`** is `derived` and reports `modified`. It is ignored when every entry carries an identical timestamp and there are at least ten of them.
- **HTTP `Last-Modified`** is off by default. Behind a CDN it is the serve time; on the fixtures it produced two false edits and found nothing new.

## Results

Two corpora. One of them is another project's test set.

### The permalink corpus — 1248 pages

Built for this project: pages harvested from the Wayback Machine by dated permalink, pinned to a capture, spanning 2005–2026, ten languages and 33 hosts. Labels come from the URL path, which no HTML extractor reads. The manifest holds 1248 entries; 1242 have a capture on disk and are the ones every figure is computed over.

Languages by page: English 418, French 116, Portuguese 102, Russian 101, Japanese 94, Italian 90, German 81, Dutch 64, Arabic 64, Spanish 30, and 82 pages whose markup declares no language.

The URL is neutralised for every tool, blanked in the argument and in the HTML. Blanking only the argument leaves the permalink restated in `<link rel="canonical">`, `og:url` and numerous `<a href>` elements; measured on the same pages, that difference is worth 194 → 184 to pagedate and 192 → 163 to htmldate.

**Held-out test split, 253 pages.** Hosts are assigned to dev and test by hash of the hostname, so no site — and therefore no template — appears in both.

| tool | exact | wrong | missed | precision | accuracy |
| --- | ---: | ---: | ---: | ---: | ---: |
| htmldate (extensive) | 236 | 17 | 0 | 93.3% | 93.3% |
| pagedate (standard) | 226 | 14 | 13 | 94.2% | 89.3% |
| pagedate (extensive) | 226 | 15 | 12 | 93.8% | 89.3% |
| htmldate (fast) | 217 | 11 | 25 | 95.2% | 85.8% |
| metascraper | 178 | 41 | 34 | 81.3% | 70.4% |
| articleDateExtractor | 176 | 13 | 64 | 93.1% | 69.6% |
| pagedate (fast) | 170 | 9 | 74 | 95.0% | 67.2% |
| newspaper4k | 166 | 5 | 82 | 97.1% | 65.6% |
| goose3 | 155 | 2 | 96 | 98.7% | 61.3% |
| @extractus/article-extractor | 139 | 35 | 79 | 79.9% | 54.9% |
| unfluff | 125 | 2 | 126 | 98.4% | 49.4% |
| date_guesser | 114 | 22 | 117 | 83.8% | 45.1% |

htmldate leads by 4.0 points. pagedate is second, marginally ahead on precision, at roughly a quarter of the per-page cost, and is the only tool here that declines to answer.

htmldate is invoked with `original_date=True`, the flag that asks it for a publication date rather than the most recent date on the page. It is the only tool measured that has such a switch, and the flag is worth about eleven points to it. See [docs/BENCHMARK.md](docs/BENCHMARK.md).

**Dev/test gap**, measured through the same harness for both splits.

| | dev (tuned on) | test (held out) | gap |
| --- | ---: | ---: | ---: |
| pagedate (standard) | 96.0% | 89.3% | −6.7 |
| htmldate (extensive) | 86.3% | 93.3% | +7.0 |

htmldate is the control. It was tuned on none of this corpus and scores 7.0 points higher on the held-out hosts than on the dev ones, so the two splits are not equally hard. −6.7 is therefore a gap against a baseline above zero. Part of it is tuning residue and part is that the test split is a different set of sites; two splits and one control cannot separate them.

**Error columns.** htmldate (extensive) never declines: 0 misses, 17 wrong. pagedate declines on 13 pages and is wrong on 14. Every page in this corpus has a date, so declining can only cost accuracy; those 13 declines are 5.1 points, against a 4.0-point deficit. This does not establish that the abstention policy wins on a corpus containing undated pages, because no such benchmark exists.

**±1 day of the remaining error is timezone noise.** A post published at 23:30 local carries a local-date URL and a UTC `article:published_time`, and both are correct. Scored with one day of slack, pagedate's 11 wrong answers on dev become 4, and its 16 on the held-out split become 5.

| | strict | ±1 day |
| --- | ---: | ---: |
| pagedate (standard), dev | 96.0% / 97.6% precision | 97.5% / 99.1% precision |
| pagedate (standard), test | 90.9% / 93.5% precision | 95.3% / 98.0% precision |

Where a page stamps a UTC timestamp and also renders the same instant in its own zone, the day shown to readers is the day reported; see `localise` in `packages/pagedate/src/resolve.ts`. The remainder is undecidable from the document.

**By language.** Each row is one or two hosts, so these are host figures carrying a language label. German is `deutsche-startups.de` and `sprachlog.de`; Arabic is Al Jazeera alone. A language appears in whichever split its hosts hashed into, which is why French and Dutch have no dev row and Russian and Arabic have no test row.

| language | split | n | exact | wrong | missed | accuracy |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| German | test | 47 | 47 | 0 | 0 | 100.0% |
| English | test | 36 | 36 | 0 | 0 | 100.0% |
| Portuguese | dev | 57 | 57 | 0 | 0 | 100.0% |
| Spanish | dev | 6 | 6 | 0 | 0 | 100.0% |
| French | test | 62 | 61 | 0 | 1 | 98.4% |
| Russian | dev | 77 | 75 | 2 | 0 | 97.4% |
| English | dev | 210 | 204 | 4 | 2 | 97.1% |
| Arabic | dev | 23 | 22 | 1 | 0 | 95.7% |
| Japanese | dev | 39 | 37 | 2 | 0 | 94.9% |
| Dutch | test | 30 | 28 | 2 | 0 | 93.3% |
| Italian | test | 33 | 30 | 3 | 0 | 90.9% |
| Italian | dev | 31 | 23 | 2 | 6 | 74.2% |
| Japanese | test | 16 | 10 | 6 | 0 | 62.5% |

Two rows need reading with their causes:

- **Japanese, 94.9% dev against 62.5% test.** The year-first format (`2015.4.23`) used by the dev hosts is handled; the 16 test pages come from a different publisher whose markup is not. This is where the residual dev/test gap is concentrated.
- **Italian, 74.2% dev.** All six misses are `ilpost.it` WordPress attachment pages — `/2012/11/01/article-slug/image-slug/` — photo permalinks carrying no date in the document. The label comes from a URL structure the page never restates.

### The htmldate corpus — 55 pages

Retained for continuity with [htmldate's published table](https://github.com/adbar/htmldate). German-heavy news, and that project's own unit-test set.

| tool | precision | accuracy | ms/page |
| --- | ---: | ---: | ---: |
| htmldate (extensive) | 96.4% | 96.4% | 74.0 |
| htmldate (fast) | 97.8% | 81.8% | 11.2 |
| pagedate (standard) | 78.7% | 67.3% | 3.8 |
| pagedate (fast) | 66.7% | 25.5% | 1.6 |
| date_guesser | 63.6% | 25.5% | 113.3 |
| metascraper | 50.0% | 23.6% | 20.3 |
| newspaper4k / articleDateExtractor | 68.8% / 55.0% | 20.0% | 143.7 / 41.0 |
| @extractus / unfluff | 44.4% / 88.9% | 14.5% | 84.0 / 119.1 |
| goose3 | 66.7% | 7.3% | 133.8 |

htmldate leads by 29 points here. The two corpora fail differently, which is why both are kept: this one's failures are bare `DD.MM.YYYY` in unmarked markup, dates present only inside an `href` or an `<input value>`, and six pages whose gold label is wrong.

Those six are corrected in [`corpus-external/corrections.json`](corpus-external/corrections.json) with quoted evidence for each, and scored as a second table alongside the original rather than replacing it. Under the corrected key, htmldate's extensive mode drops 10.9 points and converges with its own fast mode.

### Speed

| | extraction only | including HTML parsing |
| --- | ---: | ---: |
| pagedate (fast) | 1.5 ms | 10.6 ms |
| pagedate (standard) | 6.1 ms | 15.9 ms |
| htmldate (fast) | — | 11.2 ms |
| htmldate (extensive) | — | 75.5 ms |

In an extension the DOM already exists and nothing pays for parsing, so the applicable figure is the left column; htmldate cannot run in that environment. In Node the parsing term dominates.

All timings are medians of repeated passes taken after every mode has been warmed. Profiling shows `fast` spending about a third of its time inside `node-html-parser`'s `querySelectorAll`; collecting `<meta>`, `<link>`, `<time>` and JSON-LD in one tree walk instead of six queries would recover part of that and has not been done.

## Reproducing

```bash
./scripts/validate.sh
```

Runs the whole pipeline and writes the dev-split tables to `results/`: toolchain versions, build, typecheck, unit tests, corpus integrity, both parity checks, then the benchmark tables. `--quick` skips the corpus rebuild and the Python tools.

The held-out tables are not included. Scoring the test split is a separate, explicit step:

```bash
node scripts/corpus/score.ts --split test                    # → permalink-pagedate-TEST.txt
node bench/bench_corpus.mjs --split test                     # → permalink-js-TEST.txt
python3 scripts/bench_python.py --corpus permalink --split test \
  | node scripts/tally.ts /dev/stdin                         # → permalink-python-TEST.txt
```

Piecemeal, on the dev split:

```bash
pnpm install && pnpm --filter pagedate build
pnpm test                          # library, extension, MCP server

node scripts/corpus/fetch.ts       # rebuild corpus/cache from the pinned captures
node scripts/corpus/verify.ts      # confirm it is byte-identical
node scripts/corpus/score.ts       # pagedate, per stratum
node bench/bench_corpus.mjs        # JS tools, permalink corpus
python3 scripts/bench_python.py --corpus permalink | node scripts/tally.ts /dev/stdin
```

Competitors install separately, so they never enter the published dependency tree:

```bash
cd bench && npm install && cd ..
pip install -r scripts/requirements-bench.txt
```

`corpus/cache/` is gitignored — third-party HTML under no licence this project controls. `corpus/manifest.jsonl` is committed, and the `fetch.sha256` on each entry lets `verify.ts` confirm a rebuilt corpus is byte-identical to the one these figures were measured on.

### Parser parity

The Node path ships `node-html-parser`; the extension gets a browser DOM. Two checks, both exiting non-zero on any disagreement:

- `bench/parity.mjs` — linkedom against node-html-parser, over all 1242 permalink pages and all 55 htmldate pages.
- `bench/parity-browser.mjs` — real Chromium against node-html-parser, over all 1242 permalink pages, through the extractor bundle the content script carries.

All three agree on every page.

The check covers a class of bug that does not surface as a wrong answer. `node-html-parser` entity-decodes `<script>` bodies, which is incorrect — `<script>` is a raw-text element — so a JSON-LD block containing `&quot;` parses as invalid JSON, is skipped as malformed, and the page falls through to a weaker signal. The library reads `innerHTML` where it differs from `textContent` for that reason, and the unit tests run against the parser that ships.

## How it works

Signals are collected independently and then ranked. Nothing short-circuits, so conflicts remain visible.

| tier | signal |
| --- | --- |
| `declared` | JSON-LD `datePublished`/`dateModified` (full `@graph` walk), OpenGraph, RSS/Atom feed entries |
| `derived` | `<time datetime>` scored by context, Dublin Core, `citation_*`, `itemprop`, sitemap `<lastmod>`, inlined CMS state |
| `inferred` | URL slug, preview-image path, visible text (`Updated on…`, `Veröffentlicht`, `公開日`), HTTP `Last-Modified` |

Resolution ranks by confidence, then source, then precision; promotes an unlabelled date to `published` when nothing claims that field; then checks for three contradictions:

- **`declared-disagreement`** — two things the site declared for the same field differ by more than 30 days.
- **`predated-content`** — the page carries several machine-readable timestamps older than the date it claims, indicating a republication stamp rather than a writing date.
- **`stale-declaration`** — a publication date long predates archive evidence of edits the page does not display.

`published` and `modified` differing is normal and is not a conflict.

Language support covers around 25 languages of month names, non-ASCII digit systems (Arabic, Persian, Devanagari, Thai, full-width), CJK structural dates (`2024年3月12日`), and ordinal suffixes in English, French, Spanish and Dutch. Unicode folding recomposes to NFC after stripping diacritics.

## The extension

Chrome and Firefox from one MV3 codebase. The toolbar panel reports both dates with provenance, an optional on-page overlay shows the age in a corner, and an optional Internet Archive check finds edits the page does not declare.

Two surfaces read pages the reader is not on. Both use the same two tiers:

| tier | what it does | what it costs |
| --- | --- | --- |
| `url` | reads each result's address | nothing; no request reaches any site |
| `fetch` | also requests the result pages | the extension contacting sites the reader has not opened |

**Right-click a link → "When was this page written?"** The address is read first; `/2019/03/04/some-post/` is an answer requiring no request and no prompt. Only when the address carries nothing does the extension request access to that one origin, at that moment, and read the page.

**Ages next to search results** on Google, Bing, DuckDuckGo, Hacker News and old Reddit. Off by default. The `url` tier requests access to the five engines; `fetch` requests the rest of the web separately. Declining the second prompt leaves the `url` tier active. The fetch tier is capped at 10 results per page load, runs three at a time, and never sends cookies.

Installing grants nothing beyond `activeTab`, `storage`, `scripting` and `contextMenus`. The results annotator is registered at runtime rather than declared in the manifest, and CI asserts that the built manifest of both targets carries no content script and no host permission.

## Repository layout

```
packages/pagedate/       the library — no runtime dependencies
  src/extract/           one module per signal
  src/parse/             normalisation, locale, plausibility
  src/resolve.ts         ranking and conflict detection
  src/staleness.ts       interval-based age comparison
  src/fetchEnv.ts        the network Env, runtime-agnostic
  src/edge/              Cloudflare Workers, Deno, Bun — no node: imports
  src/node/              Node entry point: parser, DNS, batch mode
  scripts/               evaluation and triage tools
packages/pagedate-mcp/   MCP server
apps/extension/          WXT, MV3, Chrome + Firefox from one codebase
fixtures/                17 hand-annotated pages, 8 languages
corpus/                  the permalink corpus (manifest committed, HTML not)
corpus-external/         htmldate's cached subset, plus gold corrections
scripts/corpus/          harvest → fetch → enrich → verify → score
scripts/validate.sh      reproduce every published number
bench/                   competitor harnesses, isolated node_modules
docs/                    design, benchmark, corpus notes
results/                 committed output of the last validation run
```

## Limitations

- **English is 34% of the corpus and no other language reaches 10%.** Spanish is 30 pages. Any per-language figure below roughly 50 pages is a hint rather than a measurement. German is 81 pages and was the hardest stratum to build: `heise.de`, `spiegel.de`, `zeit.de`, `taz.de` and `golem.de` were each probed and each yield zero, because German news sites use opaque article IDs rather than date permalinks, so the German stratum is blogs.
- **Permalink labels carry ±1 day of timezone noise.** `--tolerance 1` reports 95.3% against 90.9% strict on the held-out split, so eleven of the sixteen remaining wrong answers there are one day apart. Both numbers are given above.
- **Labels are silver, not gold.** They come from URL structure, not human adjudication.
- **The dev split is where the extraction rules were developed,** so every dev-split figure is optimistic. Quote the held-out split, which contains German, French, Italian, Dutch, Japanese and part of the English stratum.
- **253 held-out pages is small.** One page is 0.4 points. Treat gaps under about 4 points as noise.
- **Six manifest entries have no capture, and four entries are not articles.** The six were never fetched, carry no language and enter no score; the scorer prints `manifest entries / fetched / scored` on every run. The four are `lenta.ru` URLs ending `.js` — Tag Manager scripts under a dated permalink path. Three are among the unfetched; one 700-byte script is in the scored set, at 0.08% of the corpus.
- **Firefox's parser is unmeasured,** as is any page whose DOM is built by JavaScript the archived capture did not run. Chromium and node-html-parser agree on all 1242 pages.

## Decision log

| Decision | Rationale |
| --- | --- |
| Return candidates with provenance, not a single date | A single-date API cannot express "declared 2019, but the archive shows edits through 2024", which is the case the project exists to report |
| Confidence as a tier rather than a numeric score | A tier states what kind of evidence was found; a score implies a calibration that does not exist |
| Never widen precision | A fabricated January 1st is indistinguishable to the caller from a date the page actually stated |
| Feeds treated as a top-tier signal | Site-declared, and present on exactly the static-site blogs where inline metadata is absent |
| Sitemap `<lastmod>` reports `modified`, never `published` | That is what `<lastmod>` is defined to mean |
| Sitemap ignored when every entry shares a timestamp | That pattern is a build stamp rather than a fact about any page; the ten-entry floor prevents discarding a small site published in one sitting |
| HTTP `Last-Modified` off by default | Behind a CDN it is the serve time. On the fixtures it invented two edits and found nothing new |
| Extraction and resolution split into two functions | Extraction is synchronous and DOM-only; resolution is asynchronous and network-backed. The split matches the MV3 content-script/service-worker boundary |
| Transport shared across runtimes in `fetchEnv.ts` | A second implementation for the edge path would be a second set of guard bugs |
| `strict` degrades to `literal` rather than throwing | No portable DNS resolver exists; failing closed would push callers off the guarded path entirely |
| Staleness answers `null` on imprecise input | A page stating "2024" straddles a 180-day threshold; picking a side is the same invention as a fabricated January 1st |
| `isStale` counts undecidable pages as stale | Its use case is filtering a corpus, where letting an undated document through is how an old page gets quoted as current |
| Batch results stream out of order | Preserving input order holds every completed result behind the slowest outstanding one |
| Batch caps at one request per host | Eight workers against one domain is a denial-of-service |
| MCP server is a separate package | `pagedate` has no runtime dependencies; an MCP server requires some |
| MCP defaults to `blockPrivateNetwork: 'strict'` | Every URL it fetches was chosen by a model rather than by its operator |
| MCP tools return prose alongside structured data | A model handed a bare date uses it without qualification |
| URL blanked in the HTML as well as the argument | Otherwise the benchmark ranks tools by how hard they hunt for a URL rather than how well they read a document |
| Corrected gold labels scored as a second table | Editing an answer key in place and reporting one number measures nothing |
| Four non-article entries left in the corpus | Removing them after seeing the results would mean re-reporting every figure against a corpus redefined to flatter it |
| Search annotator registered at runtime | A manifest-declared content script contributes its `matches` to the install prompt for every installer, including those who never enable it |
| `querySelectorAll` batching not implemented | It would improve the Node benchmark and change nothing in the extension, where the browser implements the method natively |

## Documentation

- [docs/DESIGN.md](docs/DESIGN.md) — architecture, signal ladder, resolution algorithm, decision log
- [docs/BENCHMARK.md](docs/BENCHMARK.md) — full tables, fairness notes, what was tried and rejected
- [docs/CORPUS-BUILD.md](docs/CORPUS-BUILD.md) — how the corpus is built and how labels are sourced
- [docs/CORPUS-NOTES.md](docs/CORPUS-NOTES.md) — gold-standard caveats in the external corpus
- [docs/PRIVACY.md](docs/PRIVACY.md) — what the extension stores and what leaves the browser
- [docs/PUBLISHING.md](docs/PUBLISHING.md) — releasing to npm and to both extension stores
- [CONTRIBUTING.md](CONTRIBUTING.md) · [SECURITY.md](SECURITY.md) · [CHANGELOG.md](CHANGELOG.md)

## Prior art

`htmldate` (Python) is the reference implementation in this field. `metascraper`, `@extractus/article-extractor` and `unfluff` extract dates as a side effect of article extraction. None is browser-first with zero dependencies, exposes published and modified as distinct outputs, and carries provenance and confidence fields. Surveyed in [§1 of the design doc](docs/DESIGN.md#1-context).

## Licence

MIT. Portions of the discard patterns are adapted from htmldate (Apache-2.0).
