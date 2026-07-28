# Building a corpus

The benchmark in [BENCHMARK.md](BENCHMARK.md) runs on 55 pages, because that is
all of htmldate's 800-URL evaluation set that is still reachable. 55 pages puts
one page at 1.8 points and makes any gap under ~5 points noise. It is also
German-heavy news, which is htmldate's home ground and nothing like the
technical content this library targets.

This directory of scripts builds a bigger one. The hard part is not volume.

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

Only `url-permalink` is implemented so far. It is the best starting point: a
path like `/2019/08/05/slug` is exact to the day, available on every
WordPress-shaped site on the web, and derived from something no HTML extractor
reads.

`none` — pages with no publication date at all — is the gap worth caring about
next. htmldate's corpus includes only documents with clearly determinable dates,
so false positives are *structurally unmeasurable* there, and every precision
figure in this field inherits that. Refusing to answer is what the confidence
tiers exist for, and nothing currently scores it.

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
node scripts/corpus/harvest.ts --per-domain 60   # seeds.txt -> corpus/manifest.jsonl
node scripts/corpus/fetch.ts                     # manifest  -> corpus/cache/
node scripts/corpus/score.ts                     # dev split, standard mode
```

All three are deliberately slow. CDX and Wayback are free services with no SLA,
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

## Sampling, and the bias that is still there

`seeds.txt` is hand-written. That is a real bias and it is not defensible for a
published number — it samples sites I thought of. Before publishing, replace it
with a principled frame: Tranco for the head of the web, a Common Crawl index
slice for a population nobody curated, or feed directories for the long tail.

Within a domain the harvester queries each sampled (year, month) separately and
strides through the results. CDX's URL-key sort is the reason, and it bit three
times while this was being built — each one found by looking at the output, not
by reading the code:

- **Across years.** An unrestricted domain query returns the alphabetically
  first URLs, which for a date-permalink site means its earliest years and
  nothing else. A first attempt produced 3 pages, all from 2005.
- **Within a year.** `/2015/01/…` sorts before `/2015/12/…`, so per-year queries
  return January. Widening the window did not fix it — a busy site has more URLs
  in January than the window holds. Twelve pages came back labelled 1 or 2
  January. Hence sampling a month at a time.
- **Within a month.** With a quota of one per sample point, the stride always
  took index 0 — the 1st of the month, every time. Hence the `phase` argument to
  `stride`.

Each fix was only visible in the labels themselves. A corpus can be perfectly
well-formed and still be a sample of one week.

The queries are prefix matches (`url=example.com/2015&matchType=prefix`), not
domain matches with a regex filter. The regex form makes the Archive scan every
capture a domain has and answers large sites with a 504 — and an early version
of this script counted that as "no matches", silently dropping whole eras while
reporting success. Failed queries are now counted and printed. The cost of
prefix matching is that only dates in the first path segment are found; a site
publishing to `/blog/2015/08/05/` needs its seed written as `example.com/blog`.

## Permalink labels carry ±1 day of timezone noise

Measured, not theorised: of pagedate's 7 wrong answers on the dev split, **6 were
exactly one day later than the label**, and every one came from a `declared`
source — the site's own JSON-LD or OpenGraph.

A post published at 23:30 local time gets a URL built from the local date and an
`article:published_time` in UTC. The two disagree by a day, and both are correct.

This is inherent to the source and cannot be fixed by better parsing:

- A strict comparison charges the extractor for trusting the site's own
  machine-readable metadata over a path segment, which is backwards.
- Silently allowing ±1 day hides genuine off-by-one bugs.

So report both, and say which you mean. Roughly 3% of entries sit on this
boundary, which is larger than most of the differences a benchmark is used to
argue about — enough to change a ranking on its own.

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

## Still to build

- `feed` and `adjudicated` label sources
- negative examples, which need deliberate sampling rather than harvesting
- an enrichment pass over fetched HTML to fill `strata.lang`, `pageType` and
  `signals` (which of JSON-LD / meta / text / URL each page actually carries)
- a scorer that honours `holdOut` and reports per stratum instead of one number
