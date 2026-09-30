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
| Library tests | 380 passing |
| Extension tests | 351 passing |
| MCP server tests | 16 passing |
| Annotated fixtures | 17 pages, 8 languages |
| Benchmark corpus | 4302 pages, 364 hosts, 19 languages, 2005–2026 |
| Published-date accuracy, held-out split | 88.2% (htmldate: 92.0%) |
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
- **An empty answer is a valid answer.** Five of the 17 fixtures have no publication date, and every scoring harness counts a date invented on an undated page as a false positive. Neither benchmark corpus exercises that: every page in each has a determinable date, so a false positive is unmeasurable there. A negative tier of pages whose correct answer is "none" is harvested and awaiting human review ([docs/CORPUS-BUILD.md](docs/CORPUS-BUILD.md)). A preview against its unreviewed labels has pagedate inventing a date on 20% of them (14 of 70 on dev). It was 46% until a site root was treated as a listing; before any listing detection it was 59%.

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

The CLI parses HTML, so it needs the two parsers beside it:

```bash
npm install -g pagedate node-html-parser linkedom
pagedate https://example.com/post
pagedate --file page.html --url https://example.com/post --all
cat page.html | pagedate --url https://example.com/post --json
```

Without installing anything: `npx -p pagedate -p node-html-parser -p linkedom pagedate <url>`. Run without `node-html-parser`, the CLI exits `2` with a message naming the package.

A bare URL is always fetched. Stdin is read only when the page is named with `--url` and no `--file` is given, so `pagedate "$url"` is safe inside a `while read` loop. Unknown options are refused rather than ignored.

Exit codes: `0` a date was found, `1` none found, `2` the page could not be read or the arguments were wrong.

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
| `fast` | 66.3% | 1.1 | declared metadata only — JSON-LD, OpenGraph, `<time>`, URL |
| `standard` | 88.2% | 2.9 | the above plus rendered text and inline state |
| `extensive` | 89.2% | 3.7 | the above plus unlabelled text, always |

`extensive` converts 7 abstentions on the held-out split into 6 correct answers and 1 wrong one: 505 exact against `standard`'s 499, with misses falling from 30 to 23, a 1.0-point gain. It also populates `candidates` for conflict detection and for display. It is more willing to date a page that has no date, and on the negative tier it is measurably worse at declining.

`fast` costs 21.9 points of accuracy and saves about 1.8 ms per page. In an extension the DOM already exists, so that is the entire saving. In Node the caller also pays about 6 ms to parse the HTML, so `fast` moves a page from roughly 12 ms to 8 ms.

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

### The permalink corpus — 4302 pages

Built for this project: pages harvested from the Wayback Machine by dated permalink, pinned to a capture, spanning 2005–2026, 19 languages and 364 hosts. Labels come from the URL path, which no HTML extractor reads. The manifest holds 4302 entries across 364 hosts; 4215 of them, across 356 hosts, have a capture on disk and are the ones every figure is computed over.

**Two seed frames, and every entry records which one it came from.** 1248 pages come from a hand-written list of sites the author thought of — a real bias, since it decides which pages exist to be labelled. 2900 come from probing the Tranco top-5000, a published ranking nobody here curated, keeping the hosts that mechanically turn out to use date permalinks. 154 are the negative tier. `strata.frame` makes "how much of this rests on hand-picked sites" a query rather than an opinion. See [docs/CORPUS-BUILD.md](docs/CORPUS-BUILD.md).

Languages, by page: English 2802, Russian 201, Italian 167, French 160, Japanese 118, Portuguese 111, German 104, Arabic 85, Spanish 66, Dutch, Chinese, Polish, Norwegian, Korean, Hebrew, Czech, Finnish and Indonesian in smaller numbers, and 95 pages whose language could not be determined from markup or text.

**Not every page is scored.** A headline figure uses pages within 30 days of capture whose label is recoverable from the document at all — 847 on dev, 566 held out. The rest are excluded rather than counted as failures, and `score.ts` prints `manifest / fetched / in split / within lag / scored` on every run so the funnel is visible. What counts as "recoverable" is a judgement call with real consequences, discussed in [docs/CORPUS-BUILD.md](docs/CORPUS-BUILD.md).

The URL is neutralised for every tool, blanked in the argument and in the HTML. Blanking only the argument leaves the permalink restated in `<link rel="canonical">`, `og:url` and numerous `<a href>` elements; measured on the same pages, that difference is worth 194 → 184 to pagedate and 192 → 163 to htmldate.

**Held-out test split, 566 pages.** Hosts are assigned to dev and test by hash of the hostname, so no site — and therefore no template — appears in both.

| tool | exact | wrong | missed | precision | accuracy |
| --- | ---: | ---: | ---: | ---: | ---: |
| htmldate (extensive) | 521 | 45 | 0 | 92.0% | **92.0%** |
| pagedate (extensive) | 505 | 38 | 23 | 93.0% | 89.2% |
| **pagedate (standard)** | 499 | 37 | 30 | **93.1%** | 88.2% |
| htmldate (fast) | 484 | 36 | 46 | 93.1% | 85.5% |
| articleDateExtractor | 403 | 41 | 122 | 90.8% | 71.2% |
| metascraper | 395 | 87 | 84 | 82.0% | 69.8% |
| pagedate (fast) | 375 | 19 | 172 | 95.2% | 66.3% |
| newspaper4k | 364 | 14 | 188 | 96.3% | 64.3% |
| @extractus/article-extractor | 352 | 47 | 167 | 88.2% | 62.2% |
| goose3 | 312 | 11 | 243 | 96.6% | 55.1% |
| unfluff | 283 | 12 | 271 | 95.9% | 50.0% |
| date_guesser | 274 | 52 | 240 | 84.0% | 48.4% |

**htmldate leads, and pagedate is second by 3.8 points** (2.8 comparing extensive to extensive) — marginally ahead on precision, and the only tool here that will decline to answer.

**This is not the number the dev split reports, and the difference is the point.** On the split the extraction rules were developed against, pagedate scores 93.3% and htmldate 85.4% — an apparent 7.9-point lead. Held out, that inverts. Anyone quoting the dev figure would be quoting the tuning, so this README quotes the held-out one.

htmldate is invoked with `original_date=True`, the flag that asks it for a publication date rather than the most recent date on the page. It is the only tool measured that has such a switch, and the flag is worth about eleven points to it. See [docs/BENCHMARK.md](docs/BENCHMARK.md).

**Dev/test gap: 5.1 points**, measured through the same harness for both splits.

| | dev (tuned on) | test (held out) | gap |
| --- | ---: | ---: | ---: |
| pagedate (standard) | 93.3% | 88.2% | **−5.1** |
| htmldate (extensive) | 85.4% | 92.0% | **+6.6** |

htmldate is the control. It was tuned on none of this corpus and scores 6.6 points higher on the held-out hosts than on the dev ones, so the two splits are not equally hard. −5.1 is therefore a gap against a baseline above zero. Part of it is tuning residue and part is that the test split is a different set of sites; two splits and one control cannot separate them.

**Disclosure, required by [CONTRIBUTING.md](CONTRIBUTING.md).** The held-out split was scored partway through the session that produced these numbers, and extraction work continued against `dev` afterwards. Knowing the held-out figure while tuning is exactly what the split exists to prevent, so this figure is a weaker estimate than a first-and-only scoring would be. A third pool, `diag`, exists so that failures can be investigated without spending the held-out set again; it scores 95.4%.

It has since been scored a second time. A pre-release review changed the extractors — word boundaries around month names, listing detection, microdata scoping, one-word date class names — working from `dev`, `diag` and the unreviewed no-date pages, never from held-out pages. The held-out figure moved from 87.6% to 88.2%, which is three pages. The figures here are from that second scoring.

**Error columns.** htmldate (extensive) never declines: 0 misses, 45 wrong. pagedate declines on 30 pages and is wrong on 37. Every page in this corpus has a date, so declining can only cost accuracy; those 30 declines are 5.3 points, against a 3.8-point deficit. This does not establish that the abstention policy wins on a corpus containing undated pages: the negative tier that could show it is unreviewed.

**±1 day of the remaining error is timezone noise, not error.** A post published at 23:30 local carries a local-date URL and a UTC `article:published_time`, and both are correct. Applied to **every tool**, not only to ours — the flag lives in the shared table renderer for that reason:

| tool, held out | strict | ±1 day | gain |
| --- | ---: | ---: | ---: |
| htmldate (extensive) | 92.0% | 94.3% | +2.3 |
| pagedate (extensive) | 89.2% | 92.4% | +3.2 |
| pagedate (standard) | 88.2% | 91.3% | +3.1 |
| htmldate (fast) | 85.5% | 87.8% | +2.3 |

The ranking does not change. pagedate gains slightly more, which fits — more of its error sits on the midnight boundary, because it reports the site's own UTC declaration where htmldate more often reads a rendered local date — but the deficit only narrows from 3.8 to 3.0 points. Tolerance does not rescue the comparison.

Where a page stamps a UTC timestamp and also renders the same instant in its own zone, the day shown to readers is the day reported; see `localise` in `packages/pagedate/src/resolve.ts`. The remainder is undecidable from the document.

**By language.** All rows are the held-out split, so none of these hosts were tuned against:

| language | n | exact | wrong | missed | accuracy |
| --- | ---: | ---: | ---: | ---: | ---: |
| German | 47 | 47 | 0 | 0 | 100.0% |
| Chinese | 17 | 17 | 0 | 0 | 100.0% |
| Spanish | 7 | 7 | 0 | 0 | 100.0% |
| Arabic | 5 | 5 | 0 | 0 | 100.0% |
| Russian | 4 | 4 | 0 | 0 | 100.0% |
| French | 66 | 63 | 0 | 3 | 95.5% |
| Dutch | 30 | 28 | 2 | 0 | 93.3% |
| Italian | 52 | 47 | 3 | 2 | 90.4% |
| English | 322 | 272 | 30 | 18 | 84.5% |
| Japanese | 13 | 10 | 3 | 0 | 76.9% |

Three things this table is not allowed to hide.

**Most languages are one or two hosts, so these are host figures wearing a language label.** Read a row as "this template, in this language", not as a claim about the language. Anything under ~30 pages is an anecdote: Russian at 4 pages and Arabic at 5 say nothing, and they are only this thin held out — the corpus carries 201 Russian and 85 Arabic pages, which hashed mostly into the other splits.

**English is the worst large stratum at 84.5%, not the best.** It is also the only stratum big enough to be a measurement rather than a hint, and it is where nearly all the remaining error lives: 30 of the 38 wrong answers and 18 of the 23 misses. The multilingual work is not what needs attention.

**The language strata themselves were wrong until recently.** They were filled from `<html lang>` with a TLD fallback, which put every `.com` without the attribute into one `unknown` bucket — 606 pages, mixing `japanese.engadget.com` and `cctv.com` in with English blogs. Reading the page's own text cut that to 95. It also deleted a finding: German scored 58.3% before, which read as a real weakness, and was `ipcc.ch` — a Swiss domain publishing in English — being filed as German by its TLD.

### The htmldate corpus — 55 pages

Retained for continuity with [htmldate's published table](https://github.com/adbar/htmldate). German-heavy news, and that project's own unit-test set.

| tool | precision | accuracy | ms/page |
| --- | ---: | ---: | ---: |
| htmldate (extensive) | 96.4% | 96.4% | 74.0 |
| htmldate (fast) | 97.8% | 81.8% | 11.2 |
| pagedate (standard) | 79.5% | 63.6% | 3.8 |
| pagedate (fast) | 66.7% | 25.5% | 1.6 |
| date_guesser | 63.6% | 25.5% | 113.3 |
| metascraper | 50.0% | 23.6% | 20.3 |
| newspaper4k / articleDateExtractor | 68.8% / 55.0% | 20.0% | 143.7 / 41.0 |
| @extractus / unfluff | 44.4% / 88.9% | 14.5% | 84.0 / 119.1 |
| goose3 | 66.7% | 7.3% | 133.8 |

htmldate leads by 33 points here. The two corpora fail differently, which is why both are kept: this one's failures are bare `DD.MM.YYYY` in unmarked markup, dates present only inside an `href` or an `<input value>`, and six pages whose gold label is wrong.

Those six are corrected in [`corpus-external/corrections.json`](corpus-external/corrections.json) with quoted evidence for each, and scored as a second table alongside the original rather than replacing it. Under the corrected key, htmldate's extensive mode drops 10.9 points and converges with its own fast mode.

### Speed

| | extraction only | including HTML parsing |
| --- | ---: | ---: |
| pagedate (fast) | 1.9 ms | 8.3 ms |
| pagedate (standard) | 5.4 ms | 11.6 ms |
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

- `bench/parity.mjs` — linkedom against the shipped parser, over all 4215 permalink pages and all 55 htmldate pages.
- `bench/parity-browser.mjs` — real Chromium against the shipped parser, over the permalink pages, through the same extractor bundle the content script carries.

**They agree on 4211 of 4215 pages.** They did agree on every page when the corpus was 1242; tripling it produced 4 disagreements, all on hosts added in the Tranco harvest, and they are unresolved. A published figure measured through linkedom describes the shipped path on 99.9% of this corpus and not on those four. Chromium and the shipped parser agree on 4197 of the 4215, and those 18 are unresolved too.

The check earns its keep. It caught a real bug in the parser the library ships: **node-html-parser loses the rest of the document when a raw-text element's opening and closing tags differ in case** — `<SCRIPT>` closed by `</script>`, which is how a lot of pre-2013 markup is written. `techtarget.com` sends 65 kB of HTML that became *three elements*, after which the extractors correctly reported no date on a page that has one. `parseHtml` now lowercases those tag names before parsing, at 0.12 ms of a 3.30 ms parse, and `test/hardening.test.ts` covers both directions so the workaround cannot be dropped silently. This was invisible for as long as the corpus was small enough not to contain such a page.

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

- **The corpus cannot score a false positive.** Every page in it was harvested by dated permalink, so every page has a date, and a tool that invents one on an undated page is charged nothing. This is the largest single gap in every number here, and it is the one that matters most to this library's central claim. The 154-page negative tier that would close it is harvested and unreviewed; the preview against it says pagedate invents a date on 20% of those pages.
- **English is 66% of the corpus and is also its worst large stratum**, at 84.5% held out against 90–100% for German, French, Italian and Dutch. Anything under ~30 pages is an anecdote rather than a measurement — held out, Russian is 4 pages and Arabic 5.
- **Permalink labels carry ±1 day of timezone noise.** A post published at 23:30 local gets a local-date URL and a UTC `article:published_time`; both are correct. Applied to every tool alike, one day of slack moves pagedate from 88.2% to 91.3% and htmldate from 92.0% to 94.3% — it narrows the gap without closing it. The library resolves this where the page renders the instant in its own zone as well as in UTC; where the page only ever states one of the two, nothing in the document decides it.
- **Labels are silver, not gold.** They come from URL structure, not human adjudication. Checked against the sites' own declarations they hold up well — of the dev pages where a site states a date in JSON-LD or OpenGraph, the URL label matches 96.6% of the time and is within a day 99.0% — but "well" is not "adjudicated".
- **Whether a page is scoreable at all is a judgement call.** With `url-slug` held out, a page whose date appears nowhere in its own markup cannot be answered, so it is excluded rather than counted as a failure. That check searches visible text and date-bearing attributes, and deliberately not `class`/`href`, where the URL leaks back in as furniture. It is still a crude matcher deciding what a careful tool is graded on, and it looks for *a* date rather than a *publication* date. `--include-unanswerable` reports the other end of the bracket: 89.3% against 92.9% on dev.
- **The dev split is where the extraction rules were developed**, so every dev-split figure is optimistic by construction — 93.3% against 88.2% held out. Quote the held-out split.
- **566 held-out pages is small.** One page is 0.18 points. Treat gaps under ~2 points as noise.
- **The two parsers no longer agree on every page** — 4211 of 4215, all four disagreements on hosts added in the most recent harvest, and unresolved.

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
- [docs/RELEASING.md](docs/RELEASING.md) — releasing to npm and to both extension stores
- [CONTRIBUTING.md](CONTRIBUTING.md) · [SECURITY.md](SECURITY.md) · [CHANGELOG.md](CHANGELOG.md)

## Prior art

`htmldate` (Python) is the reference implementation in this field. `metascraper`, `@extractus/article-extractor` and `unfluff` extract dates as a side effect of article extraction. None is browser-first with zero dependencies, exposes published and modified as distinct outputs, and carries provenance and confidence fields. Surveyed in [§1 of the design doc](docs/DESIGN.md#1-context).

## Licence

MIT. Portions of the discard patterns are adapted from htmldate (Apache-2.0).
