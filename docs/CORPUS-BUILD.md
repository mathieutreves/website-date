# Building a corpus

The external corpus in [BENCHMARK.md](BENCHMARK.md) is 55 pages, which is all of htmldate's 800-URL evaluation set still reachable. At that size one page is 1.8 points and any gap under about 5 points is noise. It is also German-heavy news.

`scripts/corpus/` builds the other one: 4302 entries, 364 hosts, 19 languages, 2005–2026.

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

`url-permalink` carries the corpus at 4136 of the 4302 entries. A path like `/2019/08/05/slug` is exact to the day, available on every WordPress-shaped site, and derived from something no HTML extractor reads.

`feed` is the second tier, 12 entries via `harvest-feed.ts`. Every `url-permalink` entry holds `url-slug` out, which leaves the value of reading a URL unmeasurable; a feed's `<pubDate>` is independent of the URL, so on that tier `url-slug` runs and can be scored. It is not independent of `<meta>`, because the feed and `article:published_time` usually come from the same CMS field, so it referees the URL and text paths only.

`adjudicated` is not built. `none` — pages with no publication date at all — is harvested but unreviewed: 154 entries, all carrying `review: 'pending'`, which score nowhere until a person confirms them.

It is the significant gap: htmldate's corpus includes only documents with clearly determinable dates, so false positives are structurally unmeasurable there, and every precision figure in this field inherits that, including every one in this repository, since a permalink harvest also yields only pages that have a date. Until those labels are checked, only the 17-fixture local suite scores refusals.

The review cannot be delegated to a model. `CONTRIBUTING.md` forbids a model writing or adjudicating a label, and a wrong "this page has no date" rewards the tool that abstains, which is this one. `review-negative.ts` renders the queue with each page's date-shaped strings and machine-readable date markup for that reason.

## Pinning

htmldate's corpus decayed from 800 URLs to around 55 fetchable ones because it points at the live web. Every entry here is pinned to a Wayback capture:

```
https://web.archive.org/web/<timestamp>id_/<url>
```

The `id_` modifier returns the original response. Without it Wayback returns the replay, with its own banner injected and links rewritten to absolute archive URLs.

`corpus/manifest.jsonl` is committed, a few MB of metadata. The HTML lives in `corpus/cache/`, gitignored, rebuildable byte-for-byte from the manifest and verifiable against the `fetch.sha256` recorded for each entry.

## Usage

```bash
node scripts/corpus/probe-seeds.ts               # Tranco slice -> seeds-tranco.txt
node scripts/corpus/harvest.ts --frame tranco    # seeds -> corpus/manifest.jsonl
node scripts/corpus/harvest-feed.ts              # the feed-labelled tier
node scripts/corpus/harvest-negative.ts          # candidate no-date pages
node scripts/corpus/fetch.ts                     # manifest  -> corpus/cache/
node scripts/corpus/enrich.ts                    # fills lang, labelInPage, frame
node scripts/corpus/verify.ts                    # cache is byte-identical to the manifest
node scripts/corpus/score.ts                     # dev split, standard mode, per stratum
node scripts/corpus/review-negative.ts           # the negative-label review queue
node scripts/corpus/diagnose.ts --split dev      # why individual pages fail
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

## Two seed frames, and which one a result rests on

The corpus is the union of two seed lists with very different standing, and every entry records which one it came from in `strata.frame`. That is not bookkeeping: "how much of this number rests on hand-picked sites" is the first question to ask of a benchmark whose author is an entrant, and it should be a query rather than an opinion.

**`hand`** is `scripts/corpus/seeds.txt`, written by listing sites I could think of. It is a real bias and it is not defensible for a published number, because it decides which pages exist to be labelled — no amount of careful labelling downstream undoes that.

**`tranco`** is `corpus/seeds-tranco.txt`, built by `probe-seeds.ts` from the Tranco top-5000 (list `PYGVJ`, 2026-07-29), a published ranking nobody here curated. Each domain is probed with a single CDX query for `<domain>/20`, plus `/blog` and `/news` prefixes for the ones that miss, and kept only if `parsePermalinkDate` accepts at least four distinct day-precision permalinks. That is a mechanical property of the host, not a judgement about it.

The probe is where the frame's honesty lives, so its one soft spot is worth stating: accepting a host on "Wayback holds dated permalinks under this prefix" also accepts domains that once ran a blog and now serve something else. The capture-lag filter and `labelInPage` remove most of what that lets in.

### The query shape has to match the label parser

The harvester queries `<seed>/<year>`, not `<seed>/<year>/<month>`. This looks like a detail and is not: `parsePermalinkDate` accepts both `/2015/06/01/slug` and `/2015-06-01-slug`, and a `/2015/06` query can only ever match the first. Every dash-dated site therefore passed the seed probe and then returned zero rows — `bloomberg.com/news` has 55 probe hits and yielded nothing. Measured across the Tranco slice, the mismatched query shape was **39% of seeds yielding nothing and a mean of 1.9 pages per seed**; querying at the year fixed both, to 10% and 8.4.

The year query is also what makes the sampling adaptive. Rows come back in URL-key order, so taking the first N takes January; `spreadAcrossMonths` buckets them by the month in the label and round-robins across the buckets, which spreads the sample over whatever months the site actually published in. A site that published for four months of one year contributes those four rather than nothing, which a fixed list of sample months cannot do.

CDX's URL-key sort still skews the sample at three scales, and each is handled:

- **Across years.** An unrestricted domain query returns the alphabetically first URLs, which for a date-permalink site means its earliest years and nothing else. Hence one query per sampled year.
- **Within a year.** `/2015/01/…` sorts before `/2015/12/…`. On a site busy enough to fill the year window the query never reaches February, so a saturated year — and only a saturated year — is re-queried a month at a time. That costs 12× the requests and, for most sites, buys nothing.
- **Within a month.** An unphased stride always takes index 0 — the 1st of the month, every time. Hence the `phase` argument to `stride`.

None of this is visible in the code or in the manifest's shape, only in the labels themselves.

The queries are prefix matches (`url=example.com/2015&matchType=prefix`) rather than domain matches with a regex filter. The regex form makes the Archive scan every capture a domain has and answers large sites with a 504, which is indistinguishable from an empty result, so failed queries are counted and printed rather than folded into "no matches". The cost of prefix matching is that only dates in the first path segment are found; a site publishing to `/blog/2015/08/05/` needs its seed written as `example.com/blog`.

## Permalink labels carry ±1 day of timezone noise

Measured: of pagedate's 11 wrong answers on the dev split, 7 are exactly one day from the label; of its 16 on the held-out split, 11 are. They come from `declared` sources — the site's own JSON-LD or OpenGraph.

A post published at 23:30 local time gets a URL built from the local date and an `article:published_time` in UTC. The two disagree by a day and both are correct.

Part of this is recoverable. When a page stamps a UTC timestamp and also renders the same instant in its own zone, the day shown to readers is the day reported; `localise` in `resolve.ts` does this. The remainder is undecidable from the document.

Roughly 3% of entries sit on this boundary, which is larger than most differences a benchmark is used to argue about. `--tolerance 1` reports 90.8% against 87.6% strict on the held-out split. Applied to every tool alike it moves htmldate from 92.0% to 94.3%, so it narrows the gap without closing it. Both are printed.

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

## The language stratum is read from the text, not from the TLD

`enrich.ts` fills `strata.lang` from `<html lang>`, then `og:locale`, then the
page's own text, and only then the TLD.

The text step matters more than it sounds. With a TLD fallback, every `.com` with
no `lang` attribute lands in one `unknown` bucket — 606 of 4065 pages, and that
bucket was the corpus's second-worst stratum while containing
`japanese.engadget.com` and `cctv.com`. A stratum mixing six languages cannot
answer the question a language table exists to answer. Reading the text first
cuts `unknown` to 97 and surfaces Chinese, Hebrew, Czech and Finnish strata that
were previously invisible.

It also corrected a conclusion rather than merely a count. German scored 58.3%
before, which read as a real weakness in a language the external corpus is built
from — and was an artifact: `ipcc.ch` is a Swiss domain publishing in English,
which `TLD_LANG['ch'] = 'de'` had been filing under German. On the corrected
strata German is 100%.

Detection is script-first — kana before ideographs, Ukrainian before Russian,
since each is the other plus a few characters — then function-word frequency for
the Latin-script languages. Both require a real count rather than a single hit,
so a page of product names is left `unknown` rather than assigned a language.

This is a **stratum** label and not an answer key: it decides how results are
grouped for reporting, never what the right date is. That is why a mechanical
classifier is appropriate here in a way it would not be for `label.published`.

## `labelInPage`, and the circularity underneath it

`labelInPage` decides whether an entry is scored at all. With `url-slug` held
out, a page whose date appears nowhere in its own markup cannot be answered by
any extractor, so scoring it punishes a tool for correctly finding nothing.

**What counts as "in the page" is therefore not a detail — it is the line between
a tool failing and a tool being right.** The check searches visible text plus the
attributes that actually carry dates (`content`, `datetime`) and the JSON-LD
script bodies. It deliberately excludes `class`, `id`, `href` and `src`.

That exclusion was measured, not assumed. Searching the raw HTML — the obvious
implementation — makes the flag true whenever the URL leaks back into the
document as furniture: `dhs.gov` carries `class="section-blog-2009-02-11"`,
`ilpost.it` and `forbes.com` link to neighbouring posts by dated permalink. Of
the dev-split misses where pagedate produced no candidate at all, **none** had
the label in visible text; 19 of 27 had it only in an attribute or class name.
The corpus was scoring every one of them as an extraction failure.

Two things this still does not solve, and neither has a mechanical answer:

- **It searches for a date, not for a *publication* date.** A page that mentions
  "the conference on 6 May 2012" in its body counts as carrying its own label.
  The flag asks whether the information is present, which is a weaker question
  than the one the benchmark is scoring.
- **It is a crude matcher deciding what a careful tool is graded on.** Too loose
  and the tool is punished for refusing; too tight and it flatters itself. There
  is no version of this proxy that escapes that, which is the argument for the
  `adjudicated` tier below rather than for a better regex.

Because the filter is a judgement call, `score.ts` can report both ends —
`--include-unanswerable` scores everything — and a headline figure should be read
against that bracket rather than quoted alone.

## Still to build

- an `adjudicated` label source, reading the date the page renders in the page's own timezone. It is the only exit from three separate problems: the ±1 day ambiguity above, the any-date-versus-published-date weakness in `labelInPage`, and the silver tier of the whole answer key
- review of the proposed negative tier. `harvest-negative.ts` collects candidate no-date pages — homepages and section fronts, which have no publication date of their own — and `review-negative.ts` renders them for adjudication. They are recorded with `review: 'pending'` and score nowhere until a person confirms them
- `pageType` and `signals` strata, recording which of JSON-LD, meta, text and URL each page carries. `enrich.ts` fills `lang`, `labelInPage` and `frame` today

## Method decisions

| Decision | Rationale |
| --- | --- |
| Record a label source per entry, with `holdOut` | A label taken from markup, scored against an extractor that reads the same markup, makes a corpus measure itself |
| `url-permalink` as the primary tier | Exact to the day, available at scale, and derived from something no HTML extractor reads |
| A small `feed` tier alongside it | Every `url-permalink` entry holds `url-slug` out, leaving the URL signal otherwise unmeasurable |
| Record the seed frame per entry in `strata.frame` | How much of a figure rests on hand-picked sites is the first question to ask of a benchmark whose author is an entrant |
| Tranco hosts kept on a mechanical test | At least four distinct day-precision permalinks under the probed prefix is a property of the host, not a judgement about it |
| Negative labels stay `review: 'pending'` until a person confirms them | A wrong "no date" label rewards the tool that abstains, and a model may not adjudicate the answer key |
| Pin every entry to a Wayback capture | htmldate's corpus decayed from 800 URLs to 55 by pointing at the live web |
| Use the `id_` modifier | Without it the capture returns Wayback's replay rather than the page the publisher served |
| Commit the manifest, gitignore the cache | The HTML is third-party content under no licence this project controls; `fetch.sha256` makes a rebuild verifiable |
| Rate-limit harvest and fetch | CDX and Wayback are free services with no SLA |
| Append attempted seeds to a separate file | A seed that legitimately yields nothing leaves no manifest entry and would be re-queried on every resume |
| Write the manifest by temp-file-and-rename | A kill mid-write otherwise leaves a truncated manifest |
| Query per year, spread across months, with a rotating stride phase | A `/year/month` query cannot match dash-dated permalinks, and CDX's URL-key sort otherwise returns the site's earliest year, then January, then the 1st of each month |
| Re-query by month only when a year saturates | It costs 12× the requests and, for most sites, buys nothing |
| Prefix matches rather than regex domain matches | The regex form makes the Archive scan every capture a domain has and answers large sites with a 504 that looks like an empty result |
| Count and print failed queries | A 504 is indistinguishable from "no matches" unless counted separately |
| Record `captureLagDays` rather than filtering on it | The right threshold depends on what is being measured |
| Reject paginated archives, daily indexes and CMS endpoints | Their dates belong to another document or to nothing |
| Reject a URL date later than its earliest capture | A page cannot be archived before it was published, so such a date is a product code or a recycled permalink |
| Report both strict and ±1 day figures | A strict comparison charges the extractor for trusting the site's own metadata over a path segment; silently allowing ±1 day hides genuine off-by-one bugs |
