# Notes on the htmldate evaluation corpus

Findings from running against [htmldate](https://github.com/adbar/htmldate)'s public
cached corpus. Recorded because they change how the comparison numbers should be
read — in both directions.

## The published benchmark is not reproducible

htmldate's table covers 1000 pages. `tests/eval_default.json` lists 800 URLs with
gold dates, but only ~69 of the cached pages are in the public repo; the rest 404.
Every number we produce is on that ~55-page annotated subset, which is also their
unit-test set and therefore biased toward cases they handle.

Our metric implementation does reproduce their published figure on that subset —
0.903 published vs 0.909 measured for extensive mode — so the harness is measuring
what they measure.

## Some gold dates are artifacts

The gold standard is a single date per page, and for a number of pages it is a
date belonging to a *different document* that happens to appear in the markup.
This matters because rejecting exactly those dates is a deliberate design decision
here (`isBorrowedContent`), so the benchmark penalises us for it.

Verified cases:

| page | gold | what the date actually is |
| --- | --- | --- |
| `creativecommons.org.html` | 2016-05-22 | `data-permalink` on an embedded image, pointing at a different blog post (`/2016/05/22/happybdaybassel/`). The page is "What we do". |
| `hertie-school.org.leyen.html` | 2019-12-02 | `href` of a link to a different article — a Syria podcast. The page is "What's on the cards for von der Leyen?". |
| `stuttgart.de.html` | 2017-10-09 | `?from=09.10.2017&to=09.10.2017` on a "Heute" events link — generated at crawl time. A city homepage has no publication date. |
| `eff.org.2015.html` | 2016-05-04 | a path segment inside an `og:image` URL. |
| `scs78.de.html` | 2018-06-10 | a path segment inside an image filename. |

And one genuine ambiguity rather than an error:

| page | gold | our answer |
| --- | --- | --- |
| `gnu.org.gpl.html` | 2016-11-18, from a `$Date:` page-touch stamp | 2007-06-29, which the page body prints as "Version 3, 29 June 2007" |

Both are defensible. Theirs is when the page was last touched; ours is when the
document was published. For "how old is this content", ours is the better answer.

## What this does and does not excuse

Roughly five to seven of the ~29 pages we lose on look artifactual — call it a
fifth. The rest are real misses: German byline formats, dates in `title`
attributes, CMS date blocks. The gap is genuinely mostly ours.

The useful conclusion is not "their corpus is bad". It is that a single-date gold
standard cannot express the distinction this library is built around — whose
document a date belongs to, and how much to trust it. Chasing this benchmark to
the last point would mean adopting behaviour we think is wrong.

## Reproducing

```bash
node scripts/fetch-htmldate-corpus.ts             # download (gitignored)
pip3 install --user "htmldate[all]"               # their side
python3 scripts/compare_htmldate.py --mode fast      > /tmp/hd-fast.jsonl
python3 scripts/compare_htmldate.py --mode extensive > /tmp/hd-ext.jsonl
pnpm --filter pagedate build
node packages/pagedate/scripts/compare.ts         # head to head
node packages/pagedate/scripts/diagnose-misses.ts # where the misses live
```
