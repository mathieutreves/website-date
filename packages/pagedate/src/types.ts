/**
 * How much to trust a candidate. This is the field that makes the output
 * actionable rather than just another date on the screen — see docs/DESIGN.md §1.
 */
export type Confidence =
  /** The site explicitly stated this in structured metadata it controls. */
  | 'declared'
  /** Structured but weaker, or from an adjacent site-owned document. */
  | 'derived'
  /** Guessed from URL shape, prose, or transport headers. */
  | 'inferred'

export type Field = 'published' | 'modified' | 'unknown'

/**
 * How precise the underlying source actually was. Never inflated: a source that
 * said "2024" yields `year`, not `day` — see {@link Candidate.value}.
 */
export type Precision = 'year' | 'month' | 'day' | 'minute'

export type Candidate = {
  /**
   * ISO 8601, truncated to `precision`. A `year` candidate is `"2024"`, a
   * `month` candidate `"2024-03"`. Precision is never invented.
   */
  value: string
  precision: Precision
  field: Field
  /** Stable identifier for the extractor, e.g. `'jsonld'`, `'atom-feed'`. */
  source: string
  confidence: Confidence
  /** Human-readable provenance, surfaced in the extension UI on hover. */
  note?: string
}

export type ConflictKind =
  /** Two `declared` candidates for the same field disagree. The site contradicts itself. */
  | 'declared-disagreement'
  /** A declared publish date long predates a strong modification signal the site doesn't show. */
  | 'stale-declaration'
  /**
   * The page carries dated content older than the publication date it declares.
   * Timestamps cannot precede the thing they belong to, so the declared date is
   * a republication or migration stamp rather than when the content was written.
   */
  | 'predated-content'

/**
 * What a conflict is made of, as data rather than as a sentence.
 *
 * `detail` is English, so each kind also carries the values that sentence was
 * built from. A caller that wants prose takes `detail`; a caller that wants to
 * write its own sentence in its own language takes the fields and never has to
 * parse the English. Without them a translated UI has to either ship an English
 * paragraph under a translated heading, or re-derive the facts from `candidates`
 * and hope it reaches the same conclusion the detector did.
 *
 * The union discriminates on `kind`, so narrowing on it gives exactly the fields
 * that kind has and no others.
 */
type ConflictBase = {
  gapDays: number
  /**
   * English, always. Suitable for a CLI, a log line, or a UI that has no
   * translations; anything localised should build its own from the fields
   * beside it.
   */
  detail: string
}

/** One side of a disagreement: what said it, and what it said. */
export type DateClaim = {
  /** Extractor id — `opengraph`, `jsonld` — not a label for a reader. */
  source: string
  value: string
}

export type Conflict =
  | (ConflictBase & {
      kind: 'declared-disagreement'
      /** The two declarations that disagree, oldest first. */
      earlier: DateClaim
      later: DateClaim
    })
  | (ConflictBase & {
      kind: 'predated-content'
      /** The publication date the page declares, as `YYYY-MM-DD`. */
      declared: string
      /** How many distinct earlier days the page carries. Always at least 3. */
      olderCount: number
      /** The oldest of them, as `YYYY-MM-DD`. */
      oldest: string
    })
  | (ConflictBase & {
      kind: 'stale-declaration'
      /** The publication date the page declares. */
      declared: string
      /** The day the archive first saw the content change, as `YYYY-MM-DD`. */
      archived: string
    })

export type ArchiveEvent = {
  /** ISO 8601 instant of the capture that first showed changed content. */
  at: string
  digest: string
}

export type ArchiveTimeline = {
  firstCapture?: string
  lastCapture?: string
  /** Captures whose content digest differed from the preceding capture. */
  events: ArchiveEvent[]
  /** True when the CDX row limit was hit, so the history is incomplete. */
  truncated: boolean
}

export type DateResult = {
  published?: Candidate
  modified?: Candidate
  /** Everything found, unresolved and unranked. Always present. */
  candidates: Candidate[]
  conflict?: Conflict
  /** Only populated when the archive timeline was explicitly requested. */
  archive?: ArchiveTimeline
}

/**
 * Injected side effects. The library never touches the network directly: Node
 * tests inject a fixture replayer, the extension injects a shim that routes
 * through the service worker. `now` is injectable so plausibility checks are
 * deterministic under test.
 */
export type Env = {
  fetchText?: (url: string) => Promise<string | null>
  fetchHeaders?: (url: string) => Promise<Record<string, string> | null>
  now?: () => Date
  /**
   * Parses feed and sitemap XML. Defaults to the global `DOMParser`, which
   * exists in browsers and service workers but not in Node — tests inject one
   * rather than the library taking a parser dependency.
   */
  parseXml?: (xml: string) => Document | null
  /**
   * Let the feed and sitemap lookups follow links to private addresses.
   *
   * Those lookups filter the URLs a page declares before asking `fetchText` for
   * them, so that an `Env` written without a guard of its own is still not
   * steered at `http://169.254.169.254/` by a `<link>` tag. Set this when the
   * private network is the point — a dev server on localhost — and the filter
   * would discard the site's own feed. `nodeEnv` and `webEnv` set it for
   * `blockPrivateNetwork: 'off'`. Non-HTTP schemes are refused regardless.
   */
  allowPrivateNetwork?: boolean
}

/**
 * How hard to look.
 *
 * Text scanning is ~80% of extraction cost, so this is the main performance
 * lever as well as an accuracy one — worth setting deliberately when running
 * over every page rather than one on demand.
 */
export type Mode =
  /**
   * Declared metadata only: JSON-LD, meta tags, `<time>`, the URL. No text
   * scanning, roughly five times faster, and it still answers most pages
   * because most sites emit metadata.
   */
  | 'fast'
  /**
   * The default. Adds labelled text ("Published on…"), and falls back to
   * unlabelled text only when nothing labelled was found.
   */
  | 'standard'
  /**
   * Also collects unlabelled text dates even when metadata already answered.
   *
   * Measured, this buys recall rather than accuracy. On the permalink held-out
   * split it finds the same 230 correct answers as `standard` and converts one
   * abstention into a wrong answer; on the 55-page external corpus it recovers
   * two pages nothing else dates, 67.3% -> 69.1%, which is barely above that
   * corpus's noise floor. Its use is populating `candidates` for conflict
   * detection and for showing a reader everything the page contains — and it
   * will date a page that has no date, which is the property `standard` exists
   * to protect.
   */
  | 'extensive'

/**
 * Per-domain override. Adapters short-circuit nothing — generic extractors
 * still run, so contradictions between the two remain visible.
 */
export type Adapter = {
  name: string
  matches: (url: URL, doc: Document) => boolean
  extract: (doc: Document, url: URL) => Candidate[]
}
