# Contributing

Bug reports are welcome. For this project a URL plus the expected date is a complete report, and it usually becomes a fixture.

## Getting set up

```sh
pnpm install
pnpm --filter pagedate build     # the extension and the MCP server import the built library
pnpm test                        # library, extension, MCP server
pnpm typecheck
```

Node 22.12 or newer. The scripts run TypeScript directly, and Node 20 reached end of life in April 2026. CI uses Node 24 and pnpm 11.18, pinned in `packageManager`.

The benchmarks are not part of `pnpm test` and do not run in CI. They need `corpus/cache/`, which is gitignored — 188 MB of third-party HTML — and is rebuilt from the committed manifest by `scripts/corpus/fetch.ts`. See [docs/CORPUS-BUILD.md](docs/CORPUS-BUILD.md).

## Rules

**Do not tune against the held-out split.** The corpus is split by host. Measure on dev, report on test, and if you have looked at the held-out pages, say so in the pull request.

**Do not fabricate precision.** A page that gives a year yields a year. Widening a date to a day the page never stated leaves the caller unable to tell the difference. The same applies to confidence: `declared` means the site stated it in machine-readable metadata, not that the answer seems likely.

**"No date" is a correct answer.** Five of the seventeen fixtures have no publication date, and the scorers count a date invented on an undated page as a false positive. A change that lifts accuracy by guessing more often is not an improvement.

The permalink corpus cannot show this: it is harvested by dated permalink, so every page in it has a date and abstaining there can only lose points. The negative tier that covers it is built by `scripts/corpus/harvest-negative.ts`, and its labels are `review: 'pending'` until a person confirms them.

**Re-measure anything you claim.** `./scripts/validate.sh` regenerates every number in the README and the docs, and writes both the raw per-page JSONL and the rendered tables into `results/`. Commit those alongside the change. If a number moves, move it in the docs in the same commit.

**You own what you submit.** Use whatever tools you like, AI included. What is required is that you have read the diff, can explain why each branch exists, and have run `pnpm test` and `./scripts/validate.sh` yourself. Do not let a model write or adjudicate a label: the corpus answer key is the one artefact in this repository that has to be checked by a person, because a model that both writes the extractor and grades it is a closed loop.

## Adding a fixture

```sh
pnpm fixture <url> <directory-name>
```

Writes `page.html`, `headers.json`, and the feed and sitemap when the page declares them, plus a stub `expected.json`. Fill in `expect` with the right answer and `notes` with why the page is worth keeping. Captured pages are third-party content — read [fixtures/README.md](fixtures/README.md) before adding one, and prefer a page that demonstrates a class of markup over a page that is merely wrong today.

## Style

Formatting follows the existing files; there is no linter.

Comments are held to a stricter standard than the code. A comment that restates the line below it will be removed. What earns its place is what a reader cannot recover from the source: why the threshold is 0.4 and not 0.5, which corpus pages break without this branch, what the alternative costs. Write it in the present tense, as a description of how the code stands, rather than as a history of how it got there. Several comments carry measured numbers; if you change the behaviour they describe, change them too.

The same applies to the docs. Every markdown file describes the current state of the repository. A number that moved is replaced, not annotated with what it was before.

Commit messages say what changed and why, in a sentence that would mean something to someone reading `git log` a year later. Where a change moves a measured number, put it in the subject: `Read the ordinal day: 61.8% -> 63.6%`.

## Security

Do not open a public issue for a vulnerability. See [SECURITY.md](SECURITY.md).
