# Fixtures — what these pages are and where they came from

Seventeen real web pages, saved exactly as their servers sent them, with an
answer key beside each one. They are the regression tests: every date this
library learns to read, it learns against markup someone actually shipped.

Nothing here was written for the test. That is the point — a fixture rewritten
to be convenient stops testing the thing that breaks, which is the fifteen
layers of framework output, consent banners and sidebar dates a real page wraps
around its one useful timestamp. The Stack Overflow capture is 1.1 MB and the
date is four characters of it.

## Provenance

Every capture was made on 2026-07-28 by `scripts/fixture.ts`, which records the
URL and the response headers alongside the body. `expected.json` in each
directory carries the source URL, the capture date, and a note on why the page
is interesting.

| Directory | Source | Size | Publisher |
| --- | --- | --- | --- |
| `aljazeera-arabic-news` | [aljazeera.net liveblog](https://www.aljazeera.net/news/liveblog/2026/7/28/) | 522 kB | Al Jazeera Media Network |
| `astro-starlight-docs` | [docs.astro.build/en/getting-started/](https://docs.astro.build/en/getting-started/) | 148 kB | Astro |
| `bbc-chinese-news` | [bbc.com/zhongwen/articles/cg5lvqre8lzo](https://www.bbc.com/zhongwen/articles/cg5lvqre8lzo/simp) | 309 kB | BBC |
| `bbc-hindi-news` | [bbc.com/hindi/articles/c3d3kgj5yxjo](https://www.bbc.com/hindi/articles/c3d3kgj5yxjo) | 469 kB | BBC |
| `csstricks-updated` | [css-tricks.com — A Guide to Flexbox](https://css-tricks.com/snippets/css/a-guide-to-flexbox/) | 689 kB | CSS-Tricks / DigitalOcean |
| `danluu-no-date` | [danluu.com/everything-is-broken/](https://danluu.com/everything-is-broken/) | 23 kB | Dan Luu |
| `github-repo` | [github.com/adbar/htmldate](https://github.com/adbar/htmldate) | 325 kB | GitHub (page chrome) |
| `hani-korean-news` | [hani.co.kr article 1270376](https://www.hani.co.kr/arti/society/society_general/1270376.html) | 134 kB | The Hankyoreh |
| `ilpost-italian-news` | [ilpost.it 2026/07/28](https://www.ilpost.it/2026/07/28/paolo-maldini-leonardo-dimissioni-figc/) | 106 kB | Il Post |
| `mdn-docs` | [MDN — Document.lastModified](https://developer.mozilla.org/en-US/docs/Web/API/Document/lastModified) | 171 kB | Mozilla and MDN contributors |
| `overreacted-post` | [overreacted.io/a-chain-reaction/](https://overreacted.io/a-chain-reaction/) | 252 kB | Dan Abramov |
| `qiita-japanese-dev` | [qiita.com item 122f9a34360e256bf042](https://qiita.com/sumomoo/items/122f9a34360e256bf042) | 125 kB | Qiita contributor |
| `ria-russian-news` | [ria.ru 20260728](https://ria.ru/20260728/putin-2107472305.html) | 181 kB | RIA Novosti |
| `rust-blog-release` | [blog.rust-lang.org — Rust 1.81.0](https://blog.rust-lang.org/2024/09/05/Rust-1.81.0/) | 20 kB | The Rust Project |
| `simonwillison-post` | [simonwillison.net — LLMs in 2024](https://simonwillison.net/2024/Dec/31/llms-in-2024/) | 77 kB | Simon Willison |
| `stackoverflow-answer` | [Stack Overflow question 11227809](https://stackoverflow.com/questions/11227809/why-is-processing-a-sorted-array-faster-than-processing-an-unsorted-array) | 1170 kB | Stack Overflow contributors |
| `vitepress-docs` | [vitepress.dev/guide/what-is-vitepress](https://vitepress.dev/guide/what-is-vitepress) | 32 kB | VitePress |

## Terms

Copyright in these pages belongs to the publishers above, not to this project,
and none of it is relicensed by the MIT licence covering the rest of the
repository. They are retained unmodified and in full, as captured, for the sole
purpose of testing a date extractor, and they are not served, republished or
presented as content.

Two carry share-alike terms whose attribution requirement is worth stating
explicitly rather than leaving to the table above:

- **`stackoverflow-answer`** — user contributions on Stack Overflow are licensed
  [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). The question
  is *Why is processing a sorted array faster than processing an unsorted
  array?* by GManNickG and its answers by their respective authors.
- **`mdn-docs`** — MDN Web Docs prose is licensed
  [CC BY-SA 2.5](https://creativecommons.org/licenses/by-sa/2.5/) by Mozilla and
  MDN contributors.

Several others are open-source documentation whose sites state their own terms
(Astro, VitePress, the Rust Project); the news captures and personal blogs are
all rights reserved by their publishers unless those sites say otherwise. No
attempt is made here to summarise each publisher's terms, because the basis for
including them does not depend on the licence: it is a quotation for the purpose
of testing software, of a page that is publicly served to anyone who requests
it.

If you are a rights holder and you would rather your page were not here, open an
issue and it will be removed and replaced. Nothing in the suite depends on any
one page.

## What was stripped

`Set-Cookie` response headers were removed from `headers.json` after capture.
They carried per-session identifiers issued to the machine that made the
request — a Cloudflare bot-management token, a Qiita session cookie — which
belong to nobody's test suite and would have been committed verbatim. Every
other response header is as received, including the `Last-Modified` and `Date`
headers, which the extractor reads.

## Adding one

```sh
pnpm tsx scripts/fixture.ts <url> <directory-name>
```

Writes `page.html`, `headers.json`, and the feed and sitemap when the page
declares them, plus a stub `expected.json` for the answer key. Fill in the
`notes` field with what the page is and why it is worth keeping — a fixture
whose interest nobody recorded is a fixture nobody dares delete.
