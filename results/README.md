# results/

Committed output of the last full measurement run: `./scripts/validate.sh` for the dev-split tables, plus the three `--split test` commands listed in the README's Reproducing section for the held-out ones, which `validate.sh` does not run.

Each `.jsonl` is the raw per-page record a harness emitted — `{tool, file, gold, found, ms}` — and each `.txt` is the rendered table. Render any JSONL with `node scripts/tally.ts <file>`.

| file | what produced it |
| --- | --- |
| `permalink-pagedate.txt` | `scripts/corpus/score.ts` — dev split, per stratum |
| `permalink-pagedate-TEST.txt` | the same on the held-out split |
| `permalink-js.txt` | `bench/bench_corpus.mjs` — JS tools, dev split |
| `permalink-js-TEST.txt` | the same on the held-out split |
| `permalink-python.jsonl/.txt` | `scripts/bench_python.py --corpus permalink` |
| `permalink-python-TEST.jsonl/.txt` | the same on the held-out split |
| `permalink-TEST-combined.txt` | JS and Python merged into one held-out table |
| `htmldate-pagedate.txt` | `packages/pagedate/scripts/eval-htmldate.ts` — pagedate alone on their subset |
| `htmldate-leaderboard.txt` | `packages/pagedate/scripts/leaderboard.ts` |
| `modes.txt` | `packages/pagedate/scripts/modes.ts` — fast vs standard vs extensive |
| `htmldate-js.jsonl`, `htmldate-python.jsonl` | inputs to the leaderboard |
| `parser-parity.txt` | `bench/parity.mjs` — linkedom vs the shipped parser |
| `parser-parity-browser.txt` | `bench/parity-browser.mjs` — real Chromium vs the shipped parser |
| `speed-fair.txt` | `packages/pagedate/scripts/speed-fair.ts` — with and without parsing |

Quote the held-out figures. The dev split is what the library was tuned against and its numbers are optimistic by around 7 points; see [docs/BENCHMARK.md](../docs/BENCHMARK.md).

Two rows that look like they should agree and do not: `permalink-pagedate-TEST.txt` says 90.9%, `permalink-TEST-combined.txt` says 89.3%. Both are pagedate (standard) on the same 253 pages. `score.ts` blanks the dated permalink where the page declares it — `<link rel="canonical">` and `og:url` — while the competitor harness blanks every date-shaped path in the raw HTML, for every tool alike, because the competitors have no `holdOut` mechanism and would otherwise read the label out of an `<a href>`. Quote the combined table when comparing tools, `score.ts` for pagedate alone.

`permalink-TEST-combined.txt` is assembled by hand from the two harness outputs beside it. There is no script for it, so it is the one file here a rerun does not regenerate; check it against `permalink-js-TEST.txt` and `permalink-python-TEST.txt` before quoting it.

Every `ms/page` column is a median of repeated passes taken after all tools have been warmed, with the order rotated between rounds. Without that, whichever tool runs last inherits a warm JIT, and on tools sharing most of their code the bias exceeds the difference being measured.
