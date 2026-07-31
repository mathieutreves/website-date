# Building a corpus

The external corpus in [BENCHMARK.md](BENCHMARK.md) is 55 pages, because that is
all of htmldate's 800-URL evaluation set that is still reachable. 55 pages puts
one page at 1.8 points and makes any gap under ~5 points noise. It is also
German-heavy news, which is htmldate's home ground and nothing like the
technical content this library targets.

`scripts/corpus/` builds the other one: 4302 entries, 364 hosts, 19 languages,
2005–2026. The hard part is not volume.

## The problem is labels, not pages

Fetching a hundred thousand pages is a weekend. Knowing when each was published
is the entire task, and the obvious methods are circular: label a page from its
`<meta>` tags and you have built a benchmark that measures how well you read
`<meta>` tags, while the text extractor — the part that is actually hard — gets
scored against a label it never had access to.

So every entry records **where its label came from**, and `holdOut` lists the
extractor sources that must be disabled before scoring it. A page labelled from
its URL cannot be used to score `url-slug`. Ignoring that field is what makes a
corpus measure itself.

## Label sources, and what each is worth

| source | independent of | cost | tier |
| --- | --- | --- | --- |
| `url-permalink` | all markup | free, huge scale | silver |
| `feed` | rendered text | cheap | silver |
| `adjudicated` | machine-readable markup | expensive | gold |
| `none` | — | manual | gold |

`url-permalink` carries the corpus: 4136 of the 4302 entries. A path like
`/2019/08/05/slug` is exact to the day, available on every WordPress-shaped site
on the web, and derived from something no HTML extractor reads.

`feed` is the second tier, 12 entries via `harvest-feed.ts`. It exists because
every `url-permalink` entry holds `url-slug` out, which leaves the value of
reading a URL unmeasurable. A feed's `<pubDate>` is independent of the URL, so
on that tier `url-slug` runs and can be scored. It is **not** independent of
`<meta>` — the feed and `article:published_time` usually come from the same CMS
field — so it referees the URL and text paths and cannot referee metadata
extractors.

`adjudicated` is not built. `none` — pages with no publication date at all — is
**harvested but unreviewed**: 154 entries, all carrying `review: 'pending'`, which
score nowhere until a person confirms them.

It is the gap worth caring about most. htmldate's corpus includes only documents
with clearly determinable dates, so false positives are *structurally
unmeasurable* there, and every precision figure in this field inherits that —
including every one in this repository, since a permalink harvest also yields
only pages that have a date. Refusing to answer is what the confidence tiers
exist for, and until those labels are checked, only the 17-fixture local suite
scores it.

The review cannot be delegated to a model. `CONTRIBUTING.md` forbids a model
writing or adjudicating a label, and a negative label is the worst case for it: a
wrong "this page has no date" silently *rewards* the tool that abstains, which is
this one. `review-negative.ts` renders the queue with each page's date-shaped
strings and machine-readable date markup for exactly that reason.

## Pinning, so the corpus does not rot

htmldate's corpus decayed from 800 URLs to ~55 fetchable ones because it points
at the live web. Every entry here is pinned to a Wayback capture instead:

```
https://web.archive.org/web/<timestamp>id_/<url>
```

The `id_` modifier matters. Without it Wayback returns the *replay* — its own
banner injected, links rewritten to absolute archive URLs — which is not the
page anyone published and not a fair thing to parse.

What gets committed is `corpus/manifest.jsonl`, a few MB of metadata. The HTML
lives in `corpus/cache/`, gitignored, rebuildable byte-for-byte from the
manifest, and verifiable against the `fetch.sha256` recorded for each entry.
That is the difference between a benchmark others can reproduce and a table
they have to trust.

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

The harvest and fetch stages are deliberately slow. CDX and Wayback are free services with no SLA,
and getting this project blocked from the Internet Archive would be a poor trade
for a faster harvest.

## Stopping and resuming

Any of these can be killed at any point — Ctrl-C, closing the laptop, losing the
machine. Re-run the same command and it picks up.

```bash
# resume harvesting (skips seeds already attempted)
node scripts/corpus/harvest.ts --per-domain 60

# resume fetching (skips entries that already have fetch.sha256)
node scripts/corpus/fetch.ts

# score whatever is on disk right now — partial corpora score fine
node scripts/corpus/score.ts
```

**Do not run harvest and fetch at the same time.** Both rewrite
`corpus/manifest.jsonl`, and the second to finish wins — you would lose the
other's work. Harvest first, then fetch.

Three things make resume safe:

- `corpus/harvested-seeds.txt` records every seed *attempted*, appended as each
  finishes. Resume cannot be decided from the manifest alone: a site that
  legitimately yields nothing has no entries to look for, and would be
  re-queried in full on every resume.
- The manifest is written via temp-file-and-rename. A kill mid-write leaves the
  previous manifest intact rather than a truncated one.
- `fetch` records `fetch.sha256` per entry and skips anything that has it, so a
  re-run costs only what was actually missing.

Worst case on an interrupted run is losing the single seed in flight, which the
next run redoes.

## Progress

```bash
wc -l corpus/manifest.jsonl                  # entries harvested
wc -l corpus/harvested-seeds.txt             # seeds attempted
ls corpus/cache | wc -l                      # pages fetched
```

## Two seed frames, and which one a result rests on

The corpus is the union of two seed lists with very different standing, and every
entry records which one it came from in `strata.frame`. That is not bookkeeping:
"how much of this number rests on hand-picked sites" is the first question to ask
of a benchmark whose author is an entrant, and it should be a query rather than
an opinion.

**`hand`** is `scripts/corpus/seeds.txt`, written by listing sites I could think
of. It is a real bias and it is not defensible for a published number, because it
decides which pages exist to be labelled — no amount of careful labelling
downstream undoes that.

**`tranco`** is `corpus/seeds-tranco.txt`, built by `probe-seeds.ts` from the
Tranco top-5000 (list `PYGVJ`, 2026-07-29), a published ranking nobody here
curated. Each domain is probed with a single CDX query for `<domain>/20`, plus
`/blog` and `/news` prefixes for the ones that miss, and kept only if
`parsePermalinkDate` accepts at least four distinct day-precision permalinks.
That is a mechanical property of the host, not a judgement about it.

The probe is where the frame's honesty lives, so its one soft spot is worth
stating: accepting a host on "Wayback holds dated permalinks under this prefix"
also accepts domains that once ran a blog and now serve something else. The
capture-lag filter and `labelInPage` remove most of what that lets in.

### The query shape has to match the label parser

The harvester queries `<seed>/<year>`, not `<seed>/<year>/<month>`. This looks
like a detail and is not: `parsePermalinkDate` accepts both `/2015/06/01/slug`
and `/2015-06-01-slug`, and a `/2015/06` query can only ever match the first.
Every dash-dated site therefore passed the seed probe and then returned zero rows
— `bloomberg.com/news` has 55 probe hits and yielded nothing. Measured across the
Tranco slice, the mismatched query shape was **39% of seeds yielding nothing and
a mean of 1.9 pages per seed**; querying at the year fixed both, to 10% and 8.4.

The year query is also what makes the sampling adaptive. Rows come back in
URL-key order, so taking the first N takes January; `spreadAcrossMonths` buckets
them by the month in the label and round-robins across the buckets, which spreads
the sample over whatever months the site actually published in. A site that
published for four months of one year contributes those four rather than nothing,
which a fixed list of sample months cannot do.

CDX's URL-key sort still skews the sample at three scales, and each is handled:

- **Across years.** An unrestricted domain query returns the alphabetically
  first URLs, which for a date-permalink site means its earliest years and
  nothing else. Hence one query per sampled year.
- **Within a year.** `/2015/01/…` sorts before `/2015/12/…`. On a site busy
  enough to fill the year window the query never reaches February, so a
  saturated year — and only a saturated year — is re-queried a month at a time.
  That costs 12× the requests and, for most sites, buys nothing.
- **Within a month.** An unphased stride always takes index 0 — the 1st of the
  month, every time. Hence the `phase` argument to `stride`.

None of this is visible in the code or in the manifest's shape, only in the
labels themselves. A corpus can be perfectly well-formed and still be a sample of
one week.

The queries are prefix matches (`url=example.com/2015&matchType=prefix`), not
domain matches with a regex filter. The regex form makes the Archive scan every
capture a domain has and answers large sites with a 504, which is
indistinguishable from an empty result unless you look — so failed queries are
counted and printed rather than folded into "no matches". The cost of prefix
matching is that only dates in the first path segment are found; a site
publishing to `/blog/2015/08/05/` needs its seed written as `example.com/blog`.

## Permalink labels carry ±1 day of timezone noise

Measured, not theorised: of pagedate's 11 wrong answers on the dev split **7 are
exactly one day away from the label**, and of its 16 on the held-out split, 11
are. They come from `declared` sources — the site's own JSON-LD or OpenGraph.

A post published at 23:30 local time gets a URL built from the local date and an
`article:published_time` in UTC. The two disagree by a day, and both are correct.

Part of it is recoverable. When a page stamps a UTC timestamp *and* renders the
same instant in its own zone, the day it shows its readers is the day to report,
and `localise` in `resolve.ts` does that. What is left is the genuinely
undecidable part, and it cannot be fixed by better parsing:

- A strict comparison charges the extractor for trusting the site's own
  machine-readable metadata over a path segment, which is backwards.
- Silently allowing ±1 day hides genuine off-by-one bugs.

So report both, and say which you mean. Roughly 3% of entries sit on this
boundary, which is larger than most of the differences a benchmark is used to
argue about — enough to change a ranking on its own. `--tolerance 1` reports
90.8% against 87.6% strict on the held-out split — and, applied to every tool
alike, it moves htmldate from 92.0% to 94.3%, so it narrows the gap without
closing it.

There is a deeper problem, and it is the reason no amount of extraction work
closes this. The label *is* a local-versus-UTC choice, made independently by each
site's CMS: two European papers in this corpus mint the permalink on one
convention and print the byline on the other. A rule that reads the site's own
civil day is right in general and will still win pages on one split and lose them
on the other here, because the answer key disagrees with itself.

The real fix is a label source without the ambiguity: `adjudicated` reads the
date the page itself renders, in the page's own timezone.

## Capture lag

Each entry records `captureLagDays`: the gap between the labelled publication
date and the archived capture. It matters more than it sounds.

The snapshot is the *earliest* capture, which is usually close to publication —
but not always. A 2009 article first crawled in 2012 is not the 2009 page: it has
three years of accumulated comments, a sidebar full of 2012 headlines, and
sometimes an "updated" banner. An extractor will find those later dates and be
scored wrong for it, when the real problem is that the artifact drifted.

The field is recorded rather than filtered, because the right threshold depends
on what is being measured. A headline number should use a tight one.

## What the harvester rejects, and why

A raw CDX harvest of date-shaped URLs is mostly not articles:

- `/2019/06/08/slug/page/58/` — a paginated archive, whose date belongs to
  whichever post currently heads it
- `/2005/10/12/` — a daily index, which has no publication date of its own
- `/2019/08/05/slug/trackback/` — a WordPress endpoint serving XML; likewise
  `/feed/`, `/embed/`, `/attachment/`
- `/&quot/page/2009/06/08/…` — genuinely malformed captures, of which Wayback
  holds a long tail

Then one free check on what survives: **a page cannot be archived before it was
published.** A URL date later than its earliest capture is a product code, a
version number, or a recycled permalink — not a date.

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

- an `adjudicated` label source, reading the date the page itself renders in the
  page's own timezone. It is the only exit from three separate problems at once:
  the ±1 day ambiguity above, the any-date-vs-published-date weakness in
  `labelInPage`, and the silver tier of the whole answer key.
- **review of the proposed negative tier.** `harvest-negative.ts` collects
  candidate no-date pages — homepages and section fronts, which have no
  publication date of their own — and `review-negative.ts` renders them for
  adjudication. They are recorded with `review: 'pending'` and score nowhere
  until a person confirms them, because CONTRIBUTING.md forbids a model
  adjudicating the answer key, and a negative label is the one kind whose error
  silently rewards abstention.
- `pageType` and `signals` strata (which of JSON-LD / meta / text / URL each page
  actually carries). `enrich.ts` fills `lang`, `labelInPage` and `frame` today.
