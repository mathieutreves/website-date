# website-date

Find out when a web page was *actually* written — and whether it has been quietly rewritten since.

Most pages don't show a date. Many that do show the original publication date while the content has been edited for years. This project reports both dates, **where each one came from**, **how much to trust it**, and flags the case where a site contradicts itself.

Two pieces:

- **`pagedate`** — a zero-runtime-dependency, browser-first library. Takes a `Document`, returns date candidates with provenance and confidence.
- **A browser extension** (Chrome + Firefox, MV3 via WXT) that renders the result on demand.

---

## Status

Library, CLI, MCP server and extension all work and are tested. Nothing is published to npm or the extension stores yet.

| | |
| --- | --- |
| Library tests | 303 passing |
| Extension tests | 273 passing |
| MCP server tests | 16 passing |
| Annotated fixtures | 17 pages, 8 languages |
| Benchmark corpus | 1248 pages, 33 hosts, 10 languages, 2005–2026 |
| Published-date accuracy, held-out split | **90.9%** |
| Runtime dependencies | none |

Parts of this codebase were written with AI assistance. The measurements are not: every corpus label records the source it was derived from, under the rules in
[docs/CORPUS-BUILD.md](docs/CORPUS-BUILD.md), and every number above is regenerated from committed inputs by `./scripts/validate.sh`.

---

## What makes it different

Every other tool in this space returns *a date*. That is the design mistake, because the interesting cases cannot be expressed as one:

```js
result.published  // { value: '2019-03-04', confidence: 'declared', source: 'jsonld' }
result.modified   // { value: '2024-11-02', confidence: 'derived',  source: 'sitemap' }
result.conflict   // { kind: 'stale-declaration', gapDays: 2070, detail: '…' }
result.candidates // everything found, unresolved, with a note explaining each
```

Three commitments follow from that:

**Precision is never inflated.** A page that says "2024" yields `{ value: '2024', precision: 'year' }`, not a fabricated January 1st. Every other tool measured here always emits a full date, whether or not the page gave one.

**Confidence is a tier, not a score.** `declared` means the site stated it in machine-readable metadata; `derived` means structured but weaker; `inferred` means guessed from prose, a URL, or a transport header. `minConfidence: 'declared'` answers "what does this site actually claim" and will happily return nothing.

**Answering "there is no date here" is a correct answer.** Five of the 17 fixtures have no publication date, and the corpus scores true negatives. Benchmarks in this field almost never do — htmldate's corpus contains only pages with determinable dates, so false positives are *structurally unmeasurable* there, and every precision figure in the literature inherits that blind spot.

---

## Install and use

### Browser / extension content script

Zero dependencies, no HTML parser bundled — the DOM already exists.

```js
import { extractFromDocument, resolve } from 'pagedate'

const candidates = extractFromDocument(document, location.href)
const result = await resolve(candidates, location.href)
```

### Node

`node-html-parser` and `linkedom` are optional peer dependencies, needed only for this path.

```bash
pnpm add pagedate node-html-parser linkedom
```

```js
import { findDatesFromUrl, findDatesFromHtml } from 'pagedate/node'

await findDatesFromUrl('https://example.com/post')  // fetches, incl. feed and sitemap
await findDatesFromHtml(html, url)                   // offline
```

Two parsers for two jobs: HTML goes through `node-html-parser` (~2.5× faster than linkedom), XML through linkedom, which is loaded only if you actually touch a feed or sitemap. `<link>` is a void element in HTML but not in RSS, so an HTML parser reading a feed silently empties every `<link>` it meets.

### Cloudflare Workers, Deno, Bun

```js
import { parse } from 'node-html-parser'
import { findDates, webEnv } from 'pagedate/edge'

const env = webEnv()
const result = await findDates(parse(await env.fetchText(url)), url, env)
```

Nothing reachable from `pagedate/edge` imports `node:` anything, and `test/edge.test.ts` walks the import graph from the entry point to prove it rather than trusting it — a single `node:module` import behind a rarely-taken branch is exactly the thing that passes review and fails at deploy.

`webEnv` is the same code `nodeEnv` runs. The redirect walk, the timeout and the capped body read moved into a shared module rather than being reimplemented, so the two cannot drift; what is genuinely Node-only sits behind two injection points. Two consequences:

- **`blockPrivateNetwork: 'strict'` degrades to `'literal'`** without a `resolveHostname`, because there is no portable DNS resolver. The address filter still runs on every redirect hop; what is lost is "a public hostname that resolves to 127.0.0.1".
- **Workers has no `DOMParser`**, so feed and sitemap XML is skipped there unless you pass `parseXml`. That costs exactly the signals that make an undated static-site post solvable, so supply one if you are reading blogs rather than news.

### "Is this too old to use?"

```js
import { isStale, staleness } from 'pagedate'

const current = docs.filter((d) => !isStale(d.dates, { maxAgeDays: 365 }))
```

The question most programmatic callers are really asking — a retrieval pipeline filtering scraped pages, a crawler deciding what to re-fetch. Two things a hand-rolled version reliably gets wrong, so it is here once:

**Coarse precision is an interval, not a point.** A page that said "2024" refers to some instant in a 366-day window, and against a 180-day threshold that window has no answer — part of it is stale and part is not. `toInstant` resolves a partial value to the *start* of its period, which is right for gap arithmetic and would silently report the oldest reading as if it were the only one. So `staleness` works in intervals and returns `{ stale: null, reason: 'imprecise' }` when the interval straddles the threshold, for the same reason the extractors report `precision: 'year'` instead of inventing a January 1st.

**Which date counts is the caller's decision.** `basis` defaults to `'either'` — modification date when there is one, else publication. `'published'` asks when it was written; `'modified'` asks whether it has been kept current. Defaulting to one silently would make the other caller wrong.

`isStale` reduces that to a boolean and counts an undecidable page as stale, because letting an undated document through is how a three-year-old page ends up quoted as current. `whenUnknown: false` flips it.

### CLI

```bash
npx pagedate https://example.com/post
npx pagedate --file page.html --url https://example.com/post --all
cat page.html | npx pagedate --url https://example.com/post --json
```

Exit codes: `0` a date was found, `1` none found, `2` the page could not be read.

**Batch**, for a crawl rather than a page:

```bash
pagedate --batch --concurrency 8 < urls.txt > dated.ndjson
```

```
{"index":0,"url":"https://example.com/a","published":{…},"modified":null,"conflict":null}
{"docId":7,"index":3,"url":"https://example.com/b","error":"unreachable"}
```

One URL per line in, one JSON object per line out. A line may instead be a JSON object with a `url` key, whose other keys are carried through — so a document id survives the trip, and pagedate's own keys win a collision. Three decisions, all visible in the output:

- **Results stream as they finish, not in input order.** Preserving order means holding every completed result behind the slowest outstanding one, which on a batch containing a single timing-out host means buffering the whole run. Every record carries its input line `index` for callers who need it back.
- **Never more than one request per host**, whatever `--concurrency` says. Eight workers on eight pages from one domain is a small denial-of-service; the ceiling is a limit, not a quota to fill.
- **A page that fails does not stop the run.** It gets an `error` key and the pool moves on. A batch of 5000 URLs where number 12 is a dead host is a normal batch.

### MCP server

```jsonc
{ "mcpServers": { "pagedate": { "command": "npx", "args": ["-y", "pagedate-mcp"] } } }
```

[`pagedate-mcp`](packages/pagedate-mcp) gives an agent `page_freshness` and `page_date` — the check worth running before citing a source as current. A separate package, because `pagedate` has zero runtime dependencies and an MCP server cannot.

Its tools return prose as well as structured data, and that is the point rather than a convenience: a model handed `{"published": "2019-03-04"}` uses that date and says nothing about it. The text rendering puts the provenance and the confidence tier into context whether the model asked or not, and `UNDETERMINED` says in words what it does not license — *absence of a date is not evidence that a page is recent*.

Every URL it fetches was chosen by a model rather than by its operator, so `blockPrivateNetwork` defaults to `'strict'` there rather than the library's `'literal'`.

### Options

```js
extractFromDocument(document, url, {
  mode: 'standard',          // 'fast' | 'standard' (default) | 'extensive'
  dayFirst: 'day-first',     // override the DD/MM vs MM/DD heuristic
  minConfidence: 'declared', // ignore anything the site did not state itself
})
```

Text scanning is most of the extraction cost, so `mode` is the main performance lever. Accuracy on the held-out split, extraction-only time (what an extension pays, since the DOM already exists):

| mode | accuracy | ms/page | what it reads |
| --- | --- | --- | --- |
| `fast` | 68.8% | 0.9 | declared metadata only — JSON-LD, OpenGraph, `<time>`, URL |
| `standard` | **90.9%** | 3.2 | the above plus rendered text and inline state |
| `extensive` | 90.9% | 4.2 | the above plus unlabelled text, always |

**`extensive` buys recall, not accuracy.** On the held-out split it finds exactly the same 230 correct answers as `standard` and merely converts one abstention into a wrong answer — 17 wrong and 6 missed against 16 and 7. On the 55-page htmldate corpus, where more pages have no machine-readable date at all, it is worth two of them: 69.1% against 67.3%, which is one page above the noise floor of a corpus that size. Its real job is populating `candidates` for conflict detection and for showing a reader everything a page contains. If you want the extra recall, know that you are also opting into dating a page that has no date.

**`fast` is rarely the right trade.** It buys about 2.3 ms per page and costs 22.1 points of accuracy. In an extension the DOM already exists, so 2 ms is the entire saving and nothing can perceive it. In Node the caller also pays 8–11 ms to parse the HTML, so `fast` cuts a page from roughly 14 ms to 10 ms — a third of the wall clock for a quarter of the answers. It is worth reaching for in one case: a bulk pipeline where you want only what a site *declared* about itself and would rather have nothing than a guess. That intent is usually better expressed as `minConfidence: 'declared'`, which says it directly.

Timings are medians over repeated passes, taken after every mode has been warmed and with the order rotated between rounds — three modes sharing most of their code cannot be separated by a stopwatch around each one, because whichever runs first pays to compile what the others then inherit. See `packages/pagedate/scripts/modes.ts`.

### Network signals

`findDates` and the Node helpers can also ask the *site* about the page, rather than only the page about itself. Each costs at least one request, so each is a decision:

```js
await findDatesFromUrl(url, {
  sitemap: true,      // default. Looks the page up in the site's sitemap.
  httpHeaders: false, // default. Reads Last-Modified from the response headers.
})
```

- **Feeds** (`<published>`, `<updated>`, `<pubDate>`) are `declared` and always looked for. This is what makes an undated static-site post solvable at all.
- **Sitemap `<lastmod>`** is `derived` and reports `modified`, because that is what `<lastmod>` means. Ignored entirely when every entry carries the same timestamp — that is a build stamp, not a fact about any page.
- **HTTP `Last-Modified`** is off by default, and that is a measured decision rather than a cautious one: behind a CDN it is the serve time, and on the fixtures it invented two edits while finding nothing new.

---

## Results

Two corpora, because one of them is the other project's test set.

### 1. The permalink corpus — 1248 pages, nobody's test set

Built for this project: pages harvested from Wayback by dated permalink, pinned to a capture, across 2005–2026, ten languages and 33 hosts. Labels come from the URL path, which no HTML extractor reads. The manifest holds 1248 entries; 1242 of them have a capture on disk and are the ones any figure here is computed over.

Languages, by page: English 418, French 116, Portuguese 102, Russian 101, Japanese 94, Italian 90, German 81, Dutch 64, Arabic 64, Spanish 30, and 82 pages whose markup declares no language at all.

**The URL is therefore neutralised for every tool** — blanked in the argument *and* in the HTML, because every page restates its own permalink in `<link rel="canonical">`, `og:url` and a dozen `<a href>`s. Blanking only the argument is not a fair test: it costs pagedate 194→184 and htmldate 192→163 on the same pages, so leaving it in ranks tools by how hard they hunt for a URL rather than how well they read a document.

**Held-out test split — the number that counts.** Hosts are assigned to dev/test by hash, so nothing here shares a site, and therefore a template, with anything pagedate was tuned on.

| tool | exact | wrong | missed | precision | accuracy |
| --- | ---: | ---: | ---: | ---: | ---: |
| htmldate (extensive) | 236 | 17 | 0 | 93.3% | **93.3%** |
| **pagedate (standard)** | 226 | 14 | 13 | **94.2%** | 89.3% |
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

**htmldate leads, and pagedate is second by 4.0 points** — marginally ahead on precision, at roughly a quarter of the per-page cost, and the only tool here that will decline to answer.

htmldate is invoked with `original_date=True`. That flag is what asks it for a *publication* date; left at its default it returns the most recent date on the page, which is a different question from the one every gold label here poses. It is also the only tool measured that has such a switch — every other exposes a publication date and nothing else — so it is the only row a harness author can get wrong in this particular way, and getting it wrong is worth about eleven points to it. See [docs/BENCHMARK.md](docs/BENCHMARK.md).

**The dev/test gap is 6.7 points**, measured through the harness above for both splits so the two columns are comparable.

| | dev (tuned on) | test (held out) | gap |
| --- | ---: | ---: | ---: |
| pagedate (standard) | 96.0% | 89.3% | −6.7 |
| htmldate (extensive) | 86.3% | 93.3% | +7.0 |

A gap is what tuning on a corpus and reporting on it looks like, so the size of this one is the point. htmldate is the control, and its **+7.0** is the part worth reading carefully: a tool tuned on none of this does *better* on the held-out hosts than on the dev ones. The two splits are not equally hard, and the held-out set happens to suit it. So −6.7 should be read against +7.0 rather than against zero. Part of the gap is tuning residue, part is that the test split is simply a different set of sites, and two splits with one control cannot separate them.

**Read the error columns, not just the accuracy.** htmldate (extensive) never declines to answer — 0 misses, 17 wrong. pagedate declines on 13 pages and is wrong on 14. On a corpus where every page *has* a date, refusing to answer can only cost you, and those 13 declines are 5.1 points pagedate cannot win back here — more than the 4.0 it trails by. Whether that trade is right for you depends on whether a confidently wrong date costs more than no date, which is the whole reason the library reports a confidence tier instead of a number. It is not a claim that the trade wins on this benchmark; on a corpus built this way it cannot.

**±1 day of the remaining error is timezone noise, not error.** A post published at 23:30 local carries a local-date URL and a UTC `article:published_time`, and both are correct. Scored with one day of slack, pagedate's 11 wrong answers on the dev split become 4 and its 16 on the held-out split become 5:

| | strict | ±1 day |
| --- | ---: | ---: |
| pagedate (standard), dev | 96.0% / 97.6% precision | 97.5% / 99.1% precision |
| pagedate (standard), test | 90.9% / 93.5% precision | 95.3% / 98.0% precision |

Part of this noise is resolvable rather than only reportable: when a page stamps a UTC timestamp and *also* renders the same instant in its own zone, the day it shows its readers is the day reported. See `localise` in `packages/pagedate/src/resolve.ts`. What remains is the genuinely undecidable part — sites whose permalink and byline disagree about which day it was.

**Does this work outside English?** A qualified yes.

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

Three things this table is not allowed to hide.

**Each language is one or two hosts, so these are host figures wearing a language label.** German is `deutsche-startups.de` and `sprachlog.de`; Arabic is Al Jazeera alone. A language appears in whichever split its hosts hashed into, which is why French and Dutch have no dev row and Russian and Arabic have no test row. Read a row as "this template, in this language", not as a claim about the language.

**Japanese is 94.9% on dev and 62.5% on test, and the honest reading is the lower one.** The year-first format (`2015.4.23`) the dev hosts use is handled because those hosts were visible during development; the 16 test pages are a different publisher whose markup is not. This is where the residual dev/test gap is concentrated, and the held-out split is what makes it visible.

**Italian's dev misses are a corpus artifact, not a language gap.** All 6 are `ilpost.it` WordPress *attachment* pages — `/2012/11/01/article-slug/image-slug/` — which are photo permalinks carrying no date anywhere in the document. Answering "no date here" on them is arguably correct; the label comes from a URL structure the page itself never restates.

### 2. The htmldate corpus — 55 pages, their test set

Kept for continuity with [htmldate's published table](https://github.com/adbar/htmldate). German-heavy news, and their own unit-test set.

| tool | precision | accuracy | ms/page |
| --- | ---: | ---: | ---: |
| htmldate (extensive) | 96.4% | 96.4% | 74.0 |
| htmldate (fast) | 97.8% | 81.8% | 11.2 |
| **pagedate (standard)** | 78.7% | 67.3% | 3.8 |
| pagedate (fast) | 66.7% | 25.5% | 1.6 |
| date_guesser | 63.6% | 25.5% | 113.3 |
| metascraper | 50.0% | 23.6% | 20.3 |
| newspaper4k / articleDateExtractor | 68.8% / 55.0% | 20.0% | 143.7 / 41.0 |
| @extractus / unfluff | 44.4% / 88.9% | 14.5% | 84.0 / 119.1 |
| goose3 | 66.7% | 7.3% | 133.8 |

**htmldate wins here and it is not close.** That is partly home advantage and partly that it is a genuinely better general-purpose extractor on news.

The two corpora fail differently, which is why both are kept. What pagedate reads well on the permalink corpus — a year-first date format, site clocks and mastheads rejected as furniture, a ranking rule for two declarations that disagree — barely registers on German news, whose failures are bare `DD.MM.YYYY` in unmarked markup, dates that exist only inside an `href` or an `<input value>`, and six pages whose gold is wrong.

Six gold entries in this corpus are wrong — dates belonging to other documents, crawl-time artifacts, a "last revised" date scored as publication. They are corrected in [`corpus-external/corrections.json`](corpus-external/corrections.json), with quoted evidence for each, and scored as a **second table alongside the original, never replacing it**. Under the corrected key htmldate's extensive mode *drops 10.9 points* — it confidently reports artifact dates where the right answer is "none" — and converges with its own fast mode, meaning extensive's extra recall is spent entirely on dates that should not be found.

### Speed

| | extraction only | including HTML parsing |
| --- | ---: | ---: |
| pagedate (fast) | 1.5 ms | 10.6 ms |
| pagedate (standard) | 6.1 ms | 15.9 ms |
| htmldate (fast) | — | 11.2 ms |
| htmldate (extensive) | — | 75.5 ms |

Which number is honest depends on where it runs. **In an extension the DOM already exists and nothing pays for parsing**, so the real cost is the left column and htmldate cannot run there at any speed. In Node the caller pays for parsing, and that term dominates — the comparison there is really the parser, not the extractor.

All timings are medians of repeated passes taken after every mode has been warmed, for the reason given under [Options](#options). Profiled, `fast` spends about a third of its time inside `node-html-parser`'s `querySelectorAll`, so there is real headroom in collecting `<meta>`, `<link>`, `<time>` and JSON-LD in one tree walk instead of six queries. It has not been done, because a browser implements `querySelectorAll` natively and the extension — the one place these microseconds could matter — never pays that cost. It would optimise the benchmark.

---

## Reproducing all of it

```bash
./scripts/validate.sh
```

That runs the whole pipeline and writes the dev-split tables to `results/`: toolchain versions, build, typecheck, unit tests, corpus integrity, both parity checks, then the benchmark tables. `--quick` skips the corpus rebuild and the Python tools.

**The held-out tables are not in it, deliberately.** Scoring the test split is a thing to do once, at the end, not on every run — so those three commands are separate and explicit:

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
node scripts/corpus/verify.ts      # confirm it is byte-identical to ours
node scripts/corpus/score.ts       # pagedate, per stratum
node bench/bench_corpus.mjs        # JS tools, permalink corpus
python3 scripts/bench_python.py --corpus permalink | node scripts/tally.ts /dev/stdin
```

Competitors are installed separately, so nothing enters the published dependency tree:

```bash
cd bench && npm install && cd ..
pip install -r scripts/requirements-bench.txt
```

**`corpus/cache/` is gitignored** — it is other people's HTML under no licence we control. `corpus/manifest.jsonl` **is** committed, and `fetch.sha256` on each entry means a rebuilt corpus is verifiably the same one. `verify.ts` checks it. That is the difference between a benchmark you can reproduce and a table you have to trust.

### Parser parity

The Node path ships `node-html-parser`; the extension gets a real browser DOM. Two checks, because a published figure measured through a parser nobody runs describes nothing, and both exit non-zero on any disagreement:

- `bench/parity.mjs` — linkedom against node-html-parser, over all 1242 permalink pages and all 55 htmldate pages.
- `bench/parity-browser.mjs` — real Chromium against node-html-parser, over all 1242 permalink pages, through the same extractor bundle the content script carries.

All three agree on every page.

The check guards a class of bug that never shows up as a wrong answer. `node-html-parser` entity-decodes `<script>` bodies, which is wrong — `<script>` is a raw-text element — so a JSON-LD block containing `&quot;` parses as invalid JSON, is skipped as malformed, and the page falls through to a weaker signal. Not a wrong date; a silently *worse* one, on exactly the pages that had the strongest available answer. The library reads `innerHTML` where it differs from `textContent` for that reason, and the unit tests run against the shipped parser rather than a second one nobody deploys.

---

## How it works

Signals are collected independently, then ranked. Nothing short-circuits, so conflicts stay visible.

| tier | signal |
| --- | --- |
| `declared` | JSON-LD `datePublished`/`dateModified` (full `@graph` walk), OpenGraph, RSS/Atom feed entries |
| `derived` | `<time datetime>` scored by context, Dublin Core, `citation_*`, `itemprop`, sitemap `<lastmod>`, inlined CMS state |
| `inferred` | URL slug, preview-image path, visible text (`Updated on…`, `Veröffentlicht`, `公開日`), HTTP `Last-Modified` |

Resolution ranks by confidence → source → precision, promotes an unlabelled date to `published` when nothing claims the field, and then looks for three kinds of contradiction:

- **`declared-disagreement`** — two things the site declared for the same field differ by more than 30 days.
- **`predated-content`** — the page carries several machine-readable timestamps *older* than the date it claims. A reader cannot comment on an article before it exists, so this is a republication stamp rather than a writing date.
- **`stale-declaration`** — a publication date long predates archive evidence of edits the page does not show.

`published` and `modified` merely *differing* is normal and deliberately **not** a conflict. That distinction is what stops the flag being permanently lit and therefore ignored.

Language support covers ~25 languages of month names, non-ASCII digit systems (Arabic, Persian, Devanagari, Thai, full-width), CJK structural dates (`2024年3月12日`), and ordinal suffixes in English, French, Spanish and Dutch. Unicode folding recomposes to NFC after stripping diacritics — without that, Hangul shatters into jamo and Arabic `آ` splits.

---

## The extension

Chrome and Firefox from one MV3 codebase. The toolbar panel reports both dates with provenance, an optional on-page overlay puts the age in a corner, and the Internet Archive check finds edits a page does not admit to.

Two surfaces read pages you are **not** on, and they are built around the same rule: the cheap tier first, and the expensive tier never without being asked.

**Right-click a link → "When was this page written?"** Reads the address first — `/2019/03/04/some-post/` is an answer that costs no request and no prompt, and on blogs and news it is most links. Only when the address says nothing does it ask for access to that one origin, at that moment, and read the page. Declining leaves you exactly where you were.

**Ages next to search results** on Google, Bing, DuckDuckGo, Hacker News and old Reddit. This is the feature that changes what the extension is for: checking one page answers a question you already had, while a results list answers one you did not know to ask — that the third hit is from 2013 — before you spend a click finding out.

It has two tiers and the difference between them is the whole privacy question:

| tier | what it does | what it costs |
| --- | --- | --- |
| `url` | reads each result's address | nothing. No request reaches any site. |
| `fetch` | also requests the result pages | this extension contacting sites you have not opened |

Off by default. The `url` tier asks for access to the five engines; `fetch` asks separately for the rest of the web, because it is a much larger ask and bundling them would hide that. The fetch tier is capped at 10 results per page load — an infinite-scroll results page must not become an unbounded series of requests to third parties — runs three at a time, and never sends cookies. Declining the second prompt lands on `url` rather than `off`: the first grant was given and the cheap tier works with it.

**Installing still grants nothing.** That promise has exactly one way to break silently — a content script declared in the manifest contributes its `matches` to Chrome's install prompt — so the results annotator is registered at runtime once the setting is on and the grant exists, and CI asserts the built manifest of both targets carries no content script and no host permission.

---

## Repository layout

```
packages/pagedate/       the library — zero runtime dependencies
  src/extract/           one module per signal
  src/parse/             normalisation, locale, plausibility
  src/resolve.ts         ranking and conflict detection
  src/staleness.ts       "is this too old to use", in intervals not points
  src/fetchEnv.ts        the network Env, runtime-agnostic
  src/edge/              Cloudflare Workers, Deno, Bun — no node: imports
  src/node/              Node entry point: parser, DNS, batch mode
  scripts/               evaluation and triage tools
packages/pagedate-mcp/   MCP server, so an agent can date a source before citing it
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

---

## Limitations

- **English is 34% of the corpus, and no other language reaches 10%.** The thin strata are thin: Spanish is 30 pages, and any per-language figure below ~50 pages should be read as a hint, not a measurement. German is 81 pages and was the hardest to get — German news sites almost universally use opaque article IDs rather than date permalinks (`heise.de`, `spiegel.de`, `zeit.de`, `taz.de` and `golem.de` were each probed and each yield zero), so the German stratum is blogs and skews away from the news markup the external corpus is made of.
- **Permalink labels carry ±1 day of timezone noise.** A post published at 23:30 local gets a local-date URL and a UTC `article:published_time`; both are correct. This is not a footnote: `--tolerance 1` reports 95.3% against 90.9% strict on the held-out split, so eleven of the sixteen remaining wrong answers there are a day apart and no more. The library resolves this where the page renders the instant in its own zone as well as in UTC; where the page only ever states one of the two, nothing in the document decides it. Both numbers are given above; neither alone is honest.
- **Labels are silver, not gold.** They come from URL structure, not human adjudication.
- **The dev split is where the extraction rules were developed**, so every dev-split figure is optimistic by construction. Quote the held-out split, which is where German, French, Italian, Dutch, Japanese and part of the English stratum landed.
- **253 held-out pages is small.** One page is 0.4 points. Treat gaps under ~4 points as noise.
- **Six manifest entries have no capture, and four entries are not articles.** The six were never fetched, so they carry no language and enter no score; the scorer prints `manifest entries / fetched / scored` on every run rather than rounding them away. Separately, four `lenta.ru` URLs ending `.js` are Tag Manager scripts that happen to sit under a dated permalink path — three are among the unfetched, and one 700-byte script is in the scored set. It is 0.08% of the corpus and is left in rather than removed after the fact, which would mean re-reporting every number in this file against a corpus quietly redefined to flatter it.
- **The extension's parser is measured, and agrees.** Tests and benchmarks run node-html-parser while the extension runs a browser, so without a check every published figure would describe a parser nobody ships. [`bench/parity-browser.mjs`](bench/parity-browser.mjs) runs all 1242 corpus pages through real Chromium, using the same extractor bundle the content script carries, and compares the resolved answer against the Node path. **They agree on every page.** What remains unmeasured is narrower: Firefox's parser, and any page whose DOM is built by JavaScript that the archived capture did not run.

---

## Documentation

- [docs/DESIGN.md](docs/DESIGN.md) — architecture, signal ladder, resolution algorithm, decision log
- [docs/BENCHMARK.md](docs/BENCHMARK.md) — full tables, fairness notes, what was tried and rejected
- [docs/CORPUS-BUILD.md](docs/CORPUS-BUILD.md) — how the corpus is built and why labels are the hard part
- [docs/CORPUS-NOTES.md](docs/CORPUS-NOTES.md) — gold-standard caveats in the external corpus
- [docs/PRIVACY.md](docs/PRIVACY.md) — what the extension stores and what leaves your browser
- [docs/RELEASING.md](docs/RELEASING.md) — releasing to npm and to both extension stores
- [CONTRIBUTING.md](CONTRIBUTING.md) · [SECURITY.md](SECURITY.md) · [CHANGELOG.md](CHANGELOG.md)

## Prior art

`htmldate` (Python) is the reference implementation and the one to beat. `metascraper`, `@extractus/article-extractor` and `unfluff` extract dates as a side effect of article extraction. None of them are browser-first with zero dependencies, expose published and modified as distinct outputs, *and* carry a provenance and confidence field — which is what makes the output actionable rather than one more number on a screen. Surveyed in [§1 of the design doc](docs/DESIGN.md#1-context).

## Licence

MIT. Portions of the discard patterns are adapted from htmldate (Apache-2.0).
