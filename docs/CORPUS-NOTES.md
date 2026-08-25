# Notes on the htmldate evaluation corpus

Findings from running against [htmldate](https://github.com/adbar/htmldate)'s public cached corpus. They affect how the comparison figures in [BENCHMARK.md](BENCHMARK.md) should be read, in both directions.

## The published benchmark is not reproducible

htmldate's table covers 1000 pages. `tests/eval_default.json` lists 800 URLs with gold dates, but only around 69 of the cached pages are in the public repository; the rest return 404. Every figure produced here is on that roughly 55-page annotated subset, which is also their unit-test set and therefore biased toward cases they handle.

The subset is not directly comparable to their published 0.903 for extensive mode. `bench_python.py` calls `find_date` with `original_date=True`, because every gold label in both corpora here is a publication date and that flag selects it; on that invocation extensive mode scores 96.4% on the subset. A harness leaving the flag at its default measures a different question. Neither number validates the other.

## Some gold dates are artifacts

The gold standard is a single date per page, and for a number of pages it is a date belonging to a different document that happens to appear in the markup. Rejecting exactly those dates is a deliberate behaviour here (`isBorrowedContent`), so the benchmark penalises it.

Verified cases:

| page | gold | what the date actually is |
| --- | --- | --- |
| `creativecommons.org.html` | 2016-05-22 | `data-permalink` on an embedded image, pointing at a different blog post (`/2016/05/22/happybdaybassel/`). The page is "What we do". |
| `hertie-school.org.leyen.html` | 2019-12-02 | `href` of a link to a different article, a Syria podcast. The page is "What's on the cards for von der Leyen?". |
| `stuttgart.de.html` | 2017-10-09 | `?from=09.10.2017&to=09.10.2017` on a "Heute" events link, generated at crawl time. A city homepage has no publication date. |
| `eff.org.2015.html` | 2016-05-04 | a path segment inside an `og:image` URL. |
| `scs78.de.html` | 2018-06-10 | a path segment inside an image filename. |

One further case is an ambiguity rather than an error:

| page | gold | this project's answer |
| --- | --- | --- |
| `gnu.org.gpl.html` | 2016-11-18, from a `$Date:` page-touch stamp | 2007-06-29, which the page body prints as "Version 3, 29 June 2007" |

Both are defensible. Theirs is when the page was last touched; this one is when the document was published.

## What this does and does not excuse

Roughly five to seven of the 17 pages lost here look artifactual, out of 9 wrong and 8 missed on 55 pages. The rest are genuine misses: German byline formats, dates in `title` attributes, CMS date blocks. Most of the gap belongs to this project.

The conclusion is not that the corpus is bad. It is that a single-date gold standard cannot express whose document a date belongs to, or how much to trust it, which is what this library is built around. Chasing the last points of this benchmark would mean adopting behaviour this project considers wrong.

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

`compare_htmldate.py` is a triage tool and calls `find_date` at its default, without `original_date=True`. Its output is therefore not comparable to the tables in [BENCHMARK.md](BENCHMARK.md), which come from `bench_python.py` and do set the flag. Use it to inspect individual pages, not to quote a figure.
