# results/

Committed output of the last `./scripts/validate.sh` run.

These are here so a later reader can diff their numbers against ours rather than
take a table on trust. Each `.jsonl` is the raw per-page record a harness emitted
— `{tool, file, gold, found, ms}` — and each `.txt` is the rendered table. Render
any JSONL yourself with `node scripts/tally.ts <file>`.

| file | what produced it |
| --- | --- |
| `permalink-pagedate.txt` | `scripts/corpus/score.ts` — dev split, per stratum |
| `permalink-pagedate-TEST.txt` | the same on the held-out split |
| `permalink-js.txt` | `bench/bench_corpus.mjs` — JS tools, dev split |
| `permalink-js-TEST.txt` | the same on the held-out split |
| `permalink-python.jsonl/.txt` | `scripts/bench_python.py --corpus permalink` |
| `permalink-python-TEST.jsonl/.txt` | the same on the held-out split |
| `permalink-TEST-combined.txt` | JS and Python merged into one held-out table |
| `htmldate-leaderboard.txt` | `packages/pagedate/scripts/leaderboard.ts` |
| `htmldate-js.jsonl`, `htmldate-python.jsonl` | inputs to the leaderboard |
| `parser-parity.txt` | `bench/parity.mjs` — linkedom vs the shipped parser |

Quote the **held-out** figures. The dev split is what the library was tuned
against and its numbers are optimistic by ~13 points; see
[docs/BENCHMARK.md](../docs/BENCHMARK.md).
