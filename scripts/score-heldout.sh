#!/usr/bin/env bash
#
# Score the held-out split. Once, when the tuning is finished.
#
#   ./scripts/score-heldout.sh
#
# Deliberately not part of validate.sh. Scoring `test` on every run is how a
# held-out split stops being held out: you see the number, you form an opinion
# about a page in it, and the separation the whole corpus design rests on is
# gone. `validate.sh` reproduces the dev tables as often as you like; this is the
# command you run at the end and then quote.
#
# Use `--split diag` on the underlying tools instead when you want to know *why*
# something scores badly. That pool exists to be read; this one does not.
#
# Writes four files, all four regenerated — including the combined table, which
# used to be assembled by copying rows between the two harness outputs with no
# command that could reproduce it and nothing to catch a transcription slip.
set -uo pipefail

cd "$(dirname "$0")/.."
ROOT="$PWD"
RESULTS="$ROOT/results"
mkdir -p "$RESULTS"

step() { printf '\n\033[1m── %s\033[0m\n' "$1"; }

cat <<'BANNER'

  ┌────────────────────────────────────────────────────────────────────┐
  │  SCORING THE HELD-OUT SPLIT.                                       │
  │                                                                    │
  │  Everything this prints describes hosts the extractors were never  │
  │  tuned against. Read the numbers; do not go and read the pages.    │
  └────────────────────────────────────────────────────────────────────┘
BANNER

step "1. pagedate alone, by stratum"
# score.ts honours each entry's own holdOut, so a URL-derived label has the date
# blanked out of its URL and a feed-derived one does not. That is a different
# (and less strict) treatment from the competitor harness below, which blanks
# every date-shaped path in the raw HTML for every tool alike because the
# competitors have no holdOut mechanism at all. The two therefore disagree by a
# few pages on purpose; quote this file for pagedate on its own.
node scripts/corpus/score.ts --split test | tee "$RESULTS/permalink-pagedate-TEST.txt"

step "2. JavaScript tools"
if [ -d "$ROOT/bench/node_modules" ]; then
  node bench/bench_corpus.mjs --split test --jsonl "$RESULTS/permalink-js-TEST.jsonl" \
    | tee "$RESULTS/permalink-js-TEST.txt"
else
  echo "   bench/node_modules absent — run (cd bench && npm install)"
fi

step "3. Python tools"
if python3 -c 'import htmldate' 2>/dev/null; then
  python3 scripts/bench_python.py --corpus permalink --split test \
    > "$RESULTS/permalink-python-TEST.jsonl"
  node scripts/tally.ts "$RESULTS/permalink-python-TEST.jsonl" \
    | tee "$RESULTS/permalink-python-TEST.txt"
else
  echo "   no Python extractors — pip install -r scripts/requirements-bench.txt"
fi

step "4. Combined table — this is the one to quote when comparing tools"
if [ -f "$RESULTS/permalink-js-TEST.jsonl" ] && [ -f "$RESULTS/permalink-python-TEST.jsonl" ]; then
  node scripts/tally.ts \
    "$RESULTS/permalink-js-TEST.jsonl" "$RESULTS/permalink-python-TEST.jsonl" \
    | tee "$RESULTS/permalink-TEST-combined.txt"
else
  echo "   need both halves; combined table not written"
fi
