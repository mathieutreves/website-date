/**
 * One-shot annotation of the initial corpus.
 *
 * Ground truth here was read out of the captured HTML by hand, deliberately
 * *not* from the library's own output — a corpus derived from current behaviour
 * proves nothing. Kept in the repo as the record of how these values were set;
 * later fixtures are annotated by editing expected.json directly.
 *
 *   node scripts/annotate-initial-corpus.ts
 */

import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const FIXTURES = join(import.meta.dirname, '..', 'fixtures')

type Expectation = {
  notes: string
  published: string | null
  modified: string | null
  /** Set when we expect the library to miss this today, with the reason. */
  knownMiss?: string
}

const CORPUS: Record<string, Expectation> = {
  'ilpost-italian-news': {
    notes:
      'Italian news, clean JSON-LD + OpenGraph. Baseline easy case. Note the site declares a dateModified EARLIER than its datePublished.',
    published: '2026-07-28',
    modified: '2026-07-28',
  },

  'csstricks-updated': {
    notes:
      'The famous 2013 flexbox guide. JSON-LD declares datePublished 2026-05-28, 22 minutes before dateModified — a CMS migration stamp, not a real publication. Comment <time> elements from 2013 reveal the true age. Expectation is what the site DECLARES, since the real date is nowhere machine-readable; the point of this fixture is that the 2013 comment dates must not leak into the result.',
    published: '2026-05-28',
    modified: '2026-05-28',
  },

  'vitepress-docs': {
    notes:
      'VitePress docs. Only signal is <p class="VPLastUpdated">Last updated: <time datetime=...>. Tests label-driven field assignment: this is a modification, not a publication.',
    published: null,
    modified: '2026-07-25',
  },

  'mdn-docs': {
    notes: 'MDN reference page. Single <time> carrying the last-modified date.',
    published: null,
    modified: '2024-07-24',
  },

  'rust-blog-release': {
    notes:
      'Rust release announcement. No inline date metadata at all — the date is recoverable only from the URL slug and the site feed. Direct test of the feed-as-primary-signal claim.',
    published: '2024-09-05',
    modified: null,
  },

  'simonwillison-post': {
    notes:
      'Static blog with a full Atom feed. og:updated_time is a UNIX epoch integer (1735668451), which the normalizer does not currently accept.',
    published: '2024-12-31',
    modified: null,
  },

  'overreacted-post': {
    notes:
      'Next.js blog. No metadata whatsoever; the date exists only as bare visible text "December 11, 2023" with no "Published"/"Posted" label before it.',
    published: '2023-12-11',
    modified: null,
    knownMiss:
      'visibleText requires an anchoring label, so an unlabelled byline date is invisible to it.',
  },

  'stackoverflow-answer': {
    notes:
      'Stack Overflow question from 2012 whose top answers were edited years later. The question date needs a per-domain adapter; generic extraction sees only answer and comment timestamps.',
    published: '2012-06-27',
    modified: null,
    knownMiss: 'needs the stackexchange adapter, which is not built yet.',
  },

  'github-repo': {
    notes:
      'GitHub repository landing page. Meaningful date is the last commit, exposed via <relative-time datetime>. Needs the github adapter.',
    published: null,
    modified: null,
    knownMiss: 'needs the github adapter, which is not built yet.',
  },

  'danluu-no-date': {
    notes:
      'Deliberate true negative. Bare HTML with no date of its own; the only dates present belong to quoted third-party links. Correct behaviour is to return nothing. htmldate-style corpora exclude pages like this by construction, so this case is unscored by their metric.',
    published: null,
    modified: null,
  },

  'astro-starlight-docs': {
    notes:
      'Second true negative. The served HTML contains no date in any form. Guards against the extractors inventing one.',
    published: null,
    modified: null,
  },
}

for (const [slug, expectation] of Object.entries(CORPUS)) {
  const path = join(FIXTURES, slug, 'expected.json')

  let existing: Record<string, unknown> = {}
  try {
    existing = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
  } catch {
    console.warn(`! no captured fixture for ${slug}; skipping`)
    continue
  }

  const next = {
    ...existing,
    notes: expectation.notes,
    expect: {
      published: expectation.published,
      modified: expectation.modified,
      conflict: null,
    },
    ...(expectation.knownMiss ? { knownMiss: expectation.knownMiss } : {}),
  }

  await writeFile(path, `${JSON.stringify(next, null, 2)}\n`)
  console.log(`✓ ${slug}`)
}
