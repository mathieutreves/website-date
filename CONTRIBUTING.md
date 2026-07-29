# Contributing

Bug reports are welcome, and a bug report here has an unusually good shape
available to it: a URL. If a page's date comes out wrong, the URL plus what you
expected is a complete report, and it usually becomes a fixture.

## Getting set up

```sh
pnpm install
pnpm --filter pagedate build     # the extension and the MCP server import the built library
pnpm test                        # library, extension, MCP server
pnpm typecheck
```

Node 22.12 or newer — the scripts run TypeScript directly, and Node 20 reached
end of life in April 2026. CI uses Node 24 and pnpm 11.18, pinned in
`packageManager`.

The benchmarks are not part of `pnpm test` and do not run in CI. They need
`corpus/cache/`, which is gitignored — 188 MB of other people's HTML — and is
rebuilt from the committed manifest by `scripts/corpus/fetch.ts`. See
[docs/CORPUS-BUILD.md](docs/CORPUS-BUILD.md).

## The rules that are not style

**Do not tune against the held-out split.** The corpus is split by host, and the
split exists because tuning on a corpus and then reporting on it is the exact
failure this project was built to point at in other people's numbers. Measure on
dev, report on test, and if you have looked at the held-out pages, say so in the
pull request.

**Do not fabricate precision.** A page that gives a year yields a year. Widening
a date to a day the page never stated is worse than returning nothing, because
the caller cannot tell the difference. Same for confidence: `declared` means the
site said it in machine-readable metadata, not that we are fairly sure.

**"No date" is a correct answer.** Five of the seventeen fixtures have no
publication date and the corpus scores true negatives. A change that lifts
accuracy by guessing more often is not an improvement, and the scoring will say
so.

**Re-measure anything you claim.** `./scripts/validate.sh` regenerates every
number in the README and the docs, and writes both the raw per-page JSONL and
the rendered tables into `results/`. Commit those alongside the change. If a
number moves, move it in the docs in the same commit.

**You own what you submit.** Use whatever tools you like to write it, AI
included. What is not negotiable is that you have read the diff, can explain why
each branch exists, and have run `pnpm test` and `./scripts/validate.sh`
yourself. In particular, do not let a model write or adjudicate a label. The
corpus answer key is the one artefact in this repository that has to be checked
by a person, because a model that both writes the extractor and grades it is a
closed loop — and a closed loop is the failure this project exists to point at
in other people's numbers.

## Adding a fixture

```sh
pnpm fixture <url> <directory-name>
```

Writes `page.html`, `headers.json`, and the feed and sitemap when the page
declares them, plus a stub `expected.json`. Fill in `expect` with the right
answer and `notes` with why the page is worth keeping. Captured pages are
third-party content — read [fixtures/README.md](fixtures/README.md) before
adding one, and prefer a page that demonstrates a class of markup over a page
that is merely wrong today.

## Style

The formatting is whatever the existing files do; there is no linter to argue
with.

Comments are held to a stricter standard than the code. A comment that restates
the line below it will be removed. What earns its place is the part a reader
cannot recover from the source: why the threshold is 0.4 and not 0.5, which
corpus pages break without this branch, what the alternative costs. Write it in
the present tense, as a description of how the code stands — not as a history of
how it got there, which `git log` already holds and which goes stale the moment
the code moves again. Several comments carry measured numbers; keep that habit,
and if you change the behaviour they describe, change them too. A stale
explanation is worse than none.

The same applies to the docs. Every markdown file describes the current state of
the repository. A number that moved is replaced, not annotated with what it was
before.

Commit messages say what changed and why, in a sentence that would mean
something to someone reading `git log` a year from now. Where a change moves a
measured number, put it in the subject: `Read the ordinal day: 61.8% -> 63.6%`.
That is the one place the before-and-after belongs.

## Security

Do not open a public issue for a vulnerability. See [SECURITY.md](SECURITY.md).
