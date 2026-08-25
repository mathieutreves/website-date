# Building a corpus

The external corpus in [BENCHMARK.md](BENCHMARK.md) is 55 pages, which is all of htmldate's 800-URL evaluation set still reachable. At that size one page is 1.8 points and any gap under about 5 points is noise. It is also German-heavy news.

`scripts/corpus/` builds the other one: 1248 entries, 33 hosts, 10 declared languages, 2005–2026.

Rationale for the decisions below is collected in [Method decisions](#method-decisions).

## Labels, not pages, are the constraint

Labelling a page from its `<meta>` tags produces a benchmark that measures how well a tool reads `<meta>` tags, while the text extractor is scored against a label it never had access to.

Every entry therefore records where its label came from, and `holdOut` lists the extractor sources that must be disabled before scoring it. A page labelled from its URL cannot be used to score `url-slug`.

## Label sources

| source | independent of | cost | tier |
| --- | --- | --- | --- |
| `url-permalink` | all markup | free, large scale | silver |
| `feed` | rendered text | cheap | silver |
| `adjudicated` | machine-readable markup | expensive | gold |
| `none` | — | manual | gold |

`url-permalink` carries the corpus at 1236 of the 1248 entries. A path like `/2019/08/05/slug` is exact to the day, available on every WordPress-shaped site, and derived from something no HTML extractor reads.

`feed` is the second tier, 12 entries via `harvest-feed.ts`. Every `url-permalink` entry holds `url-slug` out, which leaves the value of reading a URL unmeasurable; a feed's `<pubDate>` is independent of the URL, so on that tier `url-slug` runs and can be scored. It is not independent of `<meta>`, because the feed and `article:published_time` usually come from the same CMS field, so it referees the URL and text paths only.

`adjudicated` and `none` are not built. `none` — pages with no publication date at all — is the significant gap: htmldate's corpus includes only documents with clearly determinable dates, so false positives are structurally unmeasurable there, and every precision figure in this field inherits that. Only the 17-fixture local suite scores refusals.

## Pinning

htmldate's corpus decayed from 800 URLs to around 55 fetchable ones because it points at the live web. Every entry here is pinned to a Wayback capture:

```
https://web.archive.org/web/<timestamp>id_/<url>
```

The `id_` modifier returns the original response. Without it Wayback returns the replay, with its own banner injected and links rewritten to absolute archive URLs.

`corpus/manifest.jsonl` is committed, a few MB of metadata. The HTML lives in `corpus/cache/`, gitignored, rebuildable byte-for-byte from the manifest and verifiable against the `fetch.sha256` recorded for each entry.

## Usage

```bash
node scripts/corpus/harvest.ts --per-domain 60   # seeds.txt -> corpus/manifest.jsonl
node scripts/corpus/harvest-feed.ts              # the feed-labelled tier
node scripts/corpus/fetch.ts                     # manifest  -> corpus/cache/
node scripts/corpus/enrich.ts                    # fills strata.lang and labelInPage
node scripts/corpus/verify.ts                    # cache is byte-identical to the manifest
node scripts/corpus/score.ts                     # dev split, standard mode, per stratum
```

The harvest and fetch stages are rate-limited. CDX and Wayback are free services with no SLA.

## Stopping and resuming

Any of these can be killed at any point and resumed by re-running the same command.

```bash
# resume harvesting (skips seeds already attempted)
node scripts/corpus/harvest.ts --per-domain 60

# resume fetching (skips entries that already have fetch.sha256)
node scripts/corpus/fetch.ts

# score whatever is on disk right now — partial corpora score fine
node scripts/corpus/score.ts
```

**Do not run harvest and fetch at the same time.** Both rewrite `corpus/manifest.jsonl` and the second to finish wins. Harvest first, then fetch.

Three mechanisms make resume safe:

- `corpus/harvested-seeds.txt` records every seed attempted, appended as each finishes. Resume cannot be decided from the manifest alone, because a site that legitimately yields nothing has no entries to look for and would be re-queried in full on every resume.
- The manifest is written via temp-file-and-rename, so a kill mid-write leaves the previous manifest intact rather than a truncated one.
- `fetch` records `fetch.sha256` per entry and skips anything that has it.

Worst case on an interrupted run is losing the single seed in flight.

## Progress

```bash
wc -l corpus/manifest.jsonl                  # entries harvested
wc -l corpus/harvested-seeds.txt             # seeds attempted
ls corpus/cache | wc -l                      # pages fetched
```

## Sampling

`seeds.txt` is hand-written, which is a sampling bias: it covers sites the author thought of. Before publishing a number derived from it, replace it with a principled frame — Tranco for the head of the web, a Common Crawl index slice for an uncurated population, or feed directories for the long tail.

Within a domain the harvester queries each sampled (year, month) separately and strides through the results with a rotating phase. CDX's URL-key sort skews the sample at three scales:

- **Across years.** An unrestricted domain query returns the alphabetically first URLs, which on a date-permalink site means its earliest years only. A whole-domain query yields a handful of pages, all from the site's first year.
- **Within a year.** `/2015/01/…` sorts before `/2015/12/…`, so a per-year query returns January. Widening the result window does not help, because a busy site has more URLs in January than any window holds. Hence sampling a month at a time.
- **Within a month.** With a quota of one page per sample point, an unphased stride always takes index 0, the 1st of the month. Hence the `phase` argument to `stride`.

None of this is visible in the code or in the manifest's shape, only in the labels themselves.

The queries are prefix matches (`url=example.com/2015&matchType=prefix`) rather than domain matches with a regex filter. The regex form makes the Archive scan every capture a domain has and answers large sites with a 504, which is indistinguishable from an empty result, so failed queries are counted and printed rather than folded into "no matches". The cost of prefix matching is that only dates in the first path segment are found; a site publishing to `/blog/2015/08/05/` needs its seed written as `example.com/blog`.

## Permalink labels carry ±1 day of timezone noise

Measured: of pagedate's 11 wrong answers on the dev split, 7 are exactly one day from the label; of its 16 on the held-out split, 11 are. They come from `declared` sources — the site's own JSON-LD or OpenGraph.

A post published at 23:30 local time gets a URL built from the local date and an `article:published_time` in UTC. The two disagree by a day and both are correct.

Part of this is recoverable. When a page stamps a UTC timestamp and also renders the same instant in its own zone, the day shown to readers is the day reported; `localise` in `resolve.ts` does this. The remainder is undecidable from the document.

Roughly 3% of entries sit on this boundary, which is larger than most differences a benchmark is used to argue about. `--tolerance 1` reports 95.3% against 90.9% strict on the held-out split. Both are printed.

The deeper limit is that the label is itself a local-versus-UTC choice made independently by each site's CMS. Two European papers in this corpus mint the permalink on one convention and print the byline on the other, so a rule that reads the site's own civil day is right in general and will still win pages on one split and lose them on the other here.

The fix is a label source without the ambiguity: `adjudicated` reads the date the page itself renders, in the page's own timezone.

## Capture lag

Each entry records `captureLagDays`, the gap between the labelled publication date and the archived capture.

The snapshot is the earliest capture, which is usually close to publication but not always. A 2009 article first crawled in 2012 has three years of accumulated comments, a sidebar of 2012 headlines, and sometimes an "updated" banner. An extractor will find those later dates and be scored wrong for it.

The field is recorded rather than filtered, because the right threshold depends on what is being measured.

## What the harvester rejects

A raw CDX harvest of date-shaped URLs is mostly not articles:

- `/2019/06/08/slug/page/58/` — a paginated archive, whose date belongs to whichever post currently heads it
- `/2005/10/12/` — a daily index, which has no publication date of its own
- `/2019/08/05/slug/trackback/` — a WordPress endpoint serving XML; likewise `/feed/`, `/embed/`, `/attachment/`
- `/&quot/page/2009/06/08/…` — malformed captures, of which Wayback holds a long tail

One further check runs on what survives: a page cannot be archived before it was published, so a URL date later than its earliest capture is a product code, a version number or a recycled permalink.

## Still to build

- an `adjudicated` label source, reading the date the page renders in the page's own timezone, which is the only way out of the ±1 day ambiguity
- negative examples, which need deliberate sampling rather than harvesting
- `pageType` and `signals` strata, recording which of JSON-LD, meta, text and URL each page carries. `enrich.ts` fills `lang` and `labelInPage` today

## Method decisions

| Decision | Rationale |
| --- | --- |
| Record a label source per entry, with `holdOut` | A label taken from markup, scored against an extractor that reads the same markup, makes a corpus measure itself |
| `url-permalink` as the primary tier | Exact to the day, available at scale, and derived from something no HTML extractor reads |
| A small `feed` tier alongside it | Every `url-permalink` entry holds `url-slug` out, leaving the URL signal otherwise unmeasurable |
| Pin every entry to a Wayback capture | htmldate's corpus decayed from 800 URLs to 55 by pointing at the live web |
| Use the `id_` modifier | Without it the capture returns Wayback's replay rather than the page the publisher served |
| Commit the manifest, gitignore the cache | The HTML is third-party content under no licence this project controls; `fetch.sha256` makes a rebuild verifiable |
| Rate-limit harvest and fetch | CDX and Wayback are free services with no SLA |
| Append attempted seeds to a separate file | A seed that legitimately yields nothing leaves no manifest entry and would be re-queried on every resume |
| Write the manifest by temp-file-and-rename | A kill mid-write otherwise leaves a truncated manifest |
| Query per (year, month) with a rotating stride phase | CDX's URL-key sort otherwise returns the site's earliest year, then January, then the 1st of each month |
| Prefix matches rather than regex domain matches | The regex form makes the Archive scan every capture a domain has and answers large sites with a 504 that looks like an empty result |
| Count and print failed queries | A 504 is indistinguishable from "no matches" unless counted separately |
| Record `captureLagDays` rather than filtering on it | The right threshold depends on what is being measured |
| Reject paginated archives, daily indexes and CMS endpoints | Their dates belong to another document or to nothing |
| Reject a URL date later than its earliest capture | A page cannot be archived before it was published, so such a date is a product code or a recycled permalink |
| Report both strict and ±1 day figures | A strict comparison charges the extractor for trusting the site's own metadata over a path segment; silently allowing ±1 day hides genuine off-by-one bugs |
