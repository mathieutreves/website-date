#!/usr/bin/env bash
#
# Reproduce every number this project publishes, from a clean checkout.
#
#   ./scripts/validate.sh              # everything
#   ./scripts/validate.sh --quick      # skip the corpus rebuild and the Python tools
#
# Written as a shell script rather than another TypeScript entry point because
# half of what it orchestrates is Python, and a reader checking our claims should
# be able to see exactly which commands produced which table without reading a
# runner first.
#
# Results are written to results/ as both the raw per-page JSONL each harness
# emits and the rendered tables. Committing those is what lets a later reader
# diff our numbers against theirs rather than take them on trust.
#
set -uo pipefail

cd "$(dirname "$0")/.."
ROOT="$PWD"
RESULTS="$ROOT/results"
QUICK=0
[ "${1:-}" = "--quick" ] && QUICK=1

mkdir -p "$RESULTS"

step() { printf '\n\033[1m── %s\033[0m\n' "$1"; }
note() { printf '   %s\n' "$1"; }

# Every stage records whether it ran, so the summary can distinguish "passed"
# from "was skipped because a tool is not installed" — a distinction a bare exit
# code loses, and the one that matters when someone else runs this.
declare -a SKIPPED=()
FAILED=0

step "1. Toolchain"
note "node    $(node --version 2>/dev/null || echo MISSING)"
note "pnpm    $(pnpm --version 2>/dev/null || echo MISSING)"
note "python3 $(python3 --version 2>&1 | awk '{print $2}' || echo MISSING)"

step "2. Install and build"
pnpm install --frozen-lockfile >/dev/null 2>&1 || pnpm install >/dev/null 2>&1
pnpm --filter pagedate build >/dev/null || { echo "build FAILED"; exit 1; }
note "packages/pagedate/dist built"

step "3. Typecheck and unit tests"
pnpm --filter pagedate typecheck || FAILED=1
pnpm --filter pagedate test --run 2>&1 | tail -5 || FAILED=1

step "4. Corpus integrity"
# The cached HTML is gitignored, so a fresh checkout has to refetch it. This is
# the step that makes the rest of the run mean anything: same bytes, or the
# comparison is void.
if [ -f "$ROOT/corpus/manifest.jsonl" ]; then
  if [ "$QUICK" = "0" ] && [ ! -d "$ROOT/corpus/cache" ]; then
    note "cache absent — fetching from the pinned Wayback captures (slow, and polite about it)"
    node scripts/corpus/fetch.ts
  fi
  node scripts/corpus/verify.ts || FAILED=1
else
  note "no corpus/manifest.jsonl — see docs/CORPUS-BUILD.md to build one"
  SKIPPED+=("permalink corpus")
fi

step "5. Parser parity"
# The shipped Node path parses with node-html-parser; everything below measures
# through linkedom. The figures only describe both while the two agree.
if [ -d "$ROOT/bench/node_modules" ] || [ -d "$ROOT/node_modules/node-html-parser" ]; then
  node bench/parity.mjs | tee "$RESULTS/parser-parity.txt" || FAILED=1
else
  SKIPPED+=("parser parity")
fi

# The parser the extension actually runs. Both checks above compare two Node
# libraries; this one compares against a real browser DOM, which is what the
# content script gets. Skipped rather than failed when Chromium is absent —
# it is a ~170 MB download and not every checkout will want it.
if node -e "require('$ROOT/bench/node_modules/playwright-core')" 2>/dev/null; then
  node bench/parity-browser.mjs | tee "$RESULTS/parser-parity-browser.txt" || FAILED=1
else
  note "no Chromium — (cd bench && npm install && npx playwright install chromium)"
  SKIPPED+=("browser parity")
fi

step "6. pagedate on the permalink corpus, by stratum"
node scripts/corpus/score.ts | tee "$RESULTS/permalink-pagedate.txt"

step "7. JavaScript tools on the permalink corpus"
# bench/ has its own node_modules so competitor packages never enter the
# published dependency tree.
if [ -d "$ROOT/bench/node_modules" ]; then
  # --jsonl as well as the table, so this half can be tallied together with the
  # Python half by a command rather than by copying rows between files.
  node bench/bench_corpus.mjs --jsonl "$RESULTS/permalink-js.jsonl" \
    | tee "$RESULTS/permalink-js.txt"
else
  note "bench/node_modules absent — run (cd bench && npm install)"
  SKIPPED+=("JS competitors")
fi

step "8. Python tools on the permalink corpus"
if [ "$QUICK" = "1" ]; then
  SKIPPED+=("Python tools (--quick)")
elif python3 -c 'import htmldate' 2>/dev/null; then
  python3 scripts/bench_python.py --corpus permalink > "$RESULTS/permalink-python.jsonl"
  node scripts/tally.ts "$RESULTS/permalink-python.jsonl" | tee "$RESULTS/permalink-python.txt"
else
  note "no Python extractors installed — pip install -r scripts/requirements-bench.txt"
  SKIPPED+=("Python tools")
fi

step "9. The htmldate corpus (their test set, for continuity with their table)"
if [ -d "$ROOT/corpus-external/htmldate/cache" ]; then
  node packages/pagedate/scripts/eval-htmldate.ts | tee "$RESULTS/htmldate-pagedate.txt"

  # The two tables that describe our own cost rather than anyone's accuracy.
  # Regenerated here rather than by hand, so results/ holds no file that no
  # documented command produces — the one thing this script exists to prevent.
  node packages/pagedate/scripts/modes.ts | tee "$RESULTS/modes.txt"
  node packages/pagedate/scripts/speed-fair.ts | tee "$RESULTS/speed-fair.txt"

  if [ "$QUICK" = "0" ] && python3 -c 'import htmldate' 2>/dev/null; then
    python3 scripts/bench_python.py > "$RESULTS/htmldate-python.jsonl"
    [ -d "$ROOT/bench/node_modules" ] && node bench/bench_js.mjs > "$RESULTS/htmldate-js.jsonl"
    node packages/pagedate/scripts/leaderboard.ts \
      "$RESULTS/htmldate-python.jsonl" "$RESULTS/htmldate-js.jsonl" \
      | tee "$RESULTS/htmldate-leaderboard.txt"
  fi
else
  note "no corpus-external/htmldate/cache — run node scripts/fetch-htmldate-corpus.ts"
  SKIPPED+=("htmldate corpus")
fi

step "10. Negative tier"
# Printed on every run because its absence changes what "precision" means in
# every table above, and a reader who does not know the tier is empty will read
# those figures as though a tool could be charged for inventing a date.
node scripts/corpus/review-negative.ts --limit 0 2>/dev/null | head -5 \
  || note "no negative entries — see docs/CORPUS-BUILD.md"

step "Summary"
if [ "${#SKIPPED[@]}" -gt 0 ]; then
  note "SKIPPED — these tables were not reproduced:"
  for s in "${SKIPPED[@]}"; do note "  · $s"; done
fi
[ "$FAILED" = "0" ] && note "tests and typecheck passed" || note "tests or typecheck FAILED"
note "tables written to results/"
exit "$FAILED"
