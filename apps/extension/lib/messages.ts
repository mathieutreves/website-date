/**
 * Every user-facing string, in one table.
 *
 * This table is the canonical source: `_locales/en/messages.json` is generated
 * from it (`pnpm gen:locales`, checked by a test), and `t()` prefers a real
 * `browser.i18n` lookup when one exists so translations override it.
 *
 * Why not use `browser.i18n` alone? The view layer is deliberately free of
 * browser APIs so it can be tested directly, and `getMessage` returns empty
 * strings outside an extension context. Keeping English here means the tests
 * assert on the strings a reader actually sees.
 *
 * Two rules for anyone adding to this file:
 *
 *   1. Never build a sentence by concatenation. `'about ' + intlPhrase` reads
 *      as "about il y a 2 ans" the moment the browser is not English — which is
 *      exactly the bug `ageApprox` exists to fix. Use a placeholder.
 *   2. Translations are drafted, then read by a human before they ship. The
 *      product rests on the difference between "stated by the site" and
 *      "inferred", and a loose rendering of that distinction misleads rather
 *      than merely reading badly — a wrong tier word is a wrong claim about
 *      how much a date can be trusted. `lib/locales/` says what was checked.
 */

export const MESSAGES = {
  // ------------------------------------------------------------------- store
  /** The product name. Not translated anywhere: it is what the listing is
   *  called and what people search for. */
  extName: 'Page Date',
  /** Shown in both stores and on the browser's extensions page. Chrome
   *  truncates past 132 characters. */
  extDescription:
    'Shows when a page was published and last modified, with where each date came from and how much to trust it.',

  // ---------------------------------------------------------------- fields
  fieldPublished: 'Published',
  fieldModified: 'Last modified',
  notDeclared: 'not declared',

  // ------------------------------------------------------------ confidence
  tierDeclared: 'stated by the site',
  tierDerived: 'from page markup',
  tierInferred: 'inferred',

  // ------------------------------------------------------------------ age
  /** {1} is a locale-formatted relative time, e.g. "2 years ago". */
  ageApprox: 'about {1}',
  ageFuture: 'dated in the future',

  // ------------------------------------------------------------- conflicts
  conflictDisagreement: 'This page contradicts itself',
  conflictPredated: 'This page is probably older than it says',
  conflictStale: 'This page may have changed since it says',

  /*
   * The sentence under each heading.
   *
   * The library also builds these, but only in English — see `conflictDetail`
   * in format.ts. Rebuilt here from the same facts so the warning is not a
   * translated heading over an English paragraph.
   *
   * `{1}` is a source label, never an extractor id, and the counted noun in
   * `conflictPredatedDetail` is safe to leave in one plural form: the detector
   * needs at least three distinct days before it will report this at all.
   */
  /** {1} = source, {2} = its date, {3} = the other source, {4} = its date. */
  conflictDisagreementDetail: '{1} says {2}, while {3} says {4} for the same field.',
  /** {1} = the declared date, {2} = a count of at least 3, {3} = the oldest date. */
  conflictPredatedDetail:
    'Declares {1}, but carries {2} dated elements from before then, back to {3}. The declared date is likely a republication, not when this was written.',
  /** {1} = the declared date, {2} = the date the archive saw it change. */
  conflictStaleDetail:
    'The page declares {1} and shows no update, but the archive records a change on {2}.',

  // ----------------------------------------------------------------- spread
  spreadTitle: 'Evidence spread',
  /** {1} = number of dates, {2} = span, e.g. "12 years". */
  spreadSummary: '{1} dates found, spanning {2}',
  spreadOldest: 'oldest',
  spreadDeclared: 'declared',

  // ------------------------------------------------------------- disclosure
  /** {1} is a count. Two keys because browser.i18n has no plural support. */
  candidatesOne: '{1} other candidate',
  candidatesMany: '{1} other candidates',
  candidateFieldPublished: 'published',
  candidateFieldModified: 'updated',
  candidateFieldUnknown: 'unlabelled',

  // ------------------------------------------------------------------ states
  loading: 'Reading page…',
  /** The toolbar tooltip, which has no room for the paragraph below. */
  badgeNoDate: 'No date found',
  emptyNoDate:
    'No date found. That is sometimes the correct answer — this page may genuinely not state when it was written.',
  emptyUnsupported: 'Open a web page to check when it was written.',
  errorUnreadable:
    'Could not read this page. Browser settings pages and extension galleries are off limits to extensions.',
  recheck: 'Re-check',
  settings: 'Settings',
  archiveCheck: 'Check the archive for hidden edits',
  archiveChecking: 'Asking the archive…',
  archiveNothing: 'The archive records no edits since this was published.',

  // ------------------------------------------------------------------ sources
  srcAdapter: 'a site-specific rule',
  srcJsonld: 'JSON-LD metadata',
  srcJsonldContainer: 'JSON-LD site metadata',
  srcAtomFeed: 'the site’s Atom feed',
  srcRssFeed: 'the site’s RSS feed',
  srcOpengraph: 'an OpenGraph tag',
  srcItemprop: 'microdata',
  srcDublinCore: 'a Dublin Core tag',
  srcCitation: 'a citation tag',
  srcParsely: 'a Parse.ly tag',
  srcSailthru: 'a Sailthru tag',
  srcTimeTag: 'a <time> element',
  srcSitemap: 'the site’s sitemap',
  srcMetaDate: 'a meta tag',
  srcUrlSlug: 'the page URL',
  srcImagePath: 'the preview image’s upload path',
  srcVisibleText: 'text on the page',
  srcTextDate: 'unlabelled text on the page',
  srcHttpLastModified: 'the Last-Modified header',

  // ------------------------------------------------------------------ options
  optTitle: 'Page Date settings',
  optPrivacyNote:
    'This extension asks for nothing at install time. Each setting below that needs wider access requests it when you turn it on, and gives it back when you turn it off.',

  optReadingHeading: 'Reading pages',
  optAutoRead: 'Check every page automatically',
  optAutoReadHelp:
    'Shows the age on the toolbar icon without opening this panel. Requires permission to read every site you visit — the browser will ask when you turn this on.',
  optAutoReadDenied: 'Permission was declined, so this stayed off.',

  optArchiveHeading: 'Internet Archive',
  optArchive: 'Check the archive for edits a page does not admit to',
  optArchiveHelp:
    'Finding edits a page hides means asking web.archive.org what it has stored, which tells them the address of the page you are on.',
  optArchiveOff: 'Never',
  optArchiveAsk: 'Ask each time',
  optArchiveAlways: 'Always',

  overlayNoDate: 'no date',
  /** {1} is the age the page declares. */
  overlaySays: 'says {1}',
  /** {1} is the age of the oldest hard evidence on the page. */
  overlayOldest: 'oldest {1}',
  /** {1} = declared age, {2} = age of the oldest evidence. */
  overlayCounterLabel: 'The page says {1}, but the oldest date it carries is from {2}.',
  /** {1} = formatted date, {2} = provenance. */
  overlayOldestDetail: 'Oldest date on the page: {1} — {2}.',

  optOverlayHeading: 'On the page',
  optOverlay: 'Show the age in the corner of the page',
  optOverlayHelp:
    'Most pages never print their own date — it sits in metadata you cannot see — so this is usually the only place it appears. Needs automatic checking to be on.',
  optOverlayNever: 'Never',
  optOverlayAlways: 'Always',
  optOverlayConflict: 'Only when contradicted',
  optOverlayPosition: 'Corner',
  optOverlayBottomLeft: 'Bottom left',
  optOverlayBottomRight: 'Bottom right',
  optOverlayTopLeft: 'Top left',
  optOverlayTopRight: 'Top right',
  optOverlayNeedsAutoRead: 'Turn on automatic checking above to use this.',

  // ------------------------------------------------------- links and results
  /** The right-click entry. A question, because that is what is being asked. */
  menuCheckLink: 'When was this page written?',
  menuChecking: 'Checking…',
  /** {1} is the link's host, so a toast that outlives the click still says what it is about. */
  menuResultFor: 'For {1}',
  menuNoDate: 'No date found for this link.',
  menuUnreachable: 'Could not read that page.',
  menuNeedsPermission: 'Permission to read that site was declined.',
  /** Spoken name of the toast's × button, which has no text of its own. */
  toastDismiss: 'Dismiss',

  /** Provenance line on a chip dated from the address alone. */
  annotateFromUrl: 'inferred from the link address',

  optSearchHeading: 'Search results',
  optSearchAnnotate: 'Show ages next to search results',
  optSearchAnnotateHelp:
    'Adds the age of each result to Google, Bing, DuckDuckGo, Hacker News and old Reddit, so a page from 2013 is visible before you click it.',
  optSearchOff: 'Never',
  /** Names the cost, not the mechanism: "no requests" is the fact that matters. */
  optSearchUrl: 'From the link address only — makes no requests',
  optSearchFetch: 'Also read the pages themselves',
  optSearchFetchHelp:
    'Reading the results themselves answers for far more of them, and means this extension requesting pages from sites you have not opened. Capped at the first {1} results on a page, and cookies are never sent.',
  optSearchDenied: 'Permission was declined, so this stayed off.',
  optSearchPartial: 'Permission to read every site was declined, so only the link address is used.',

  optLinksHeading: 'Links',
  optLinkMenu: 'Add “When was this page written?” to the right-click menu',
  optLinkMenuHelp:
    'Checks a link without opening it. Asks for access to that one site at the moment you use it, and only if the address alone does not answer.',

  optDisplayHeading: 'Display',
  optDateFormat: 'Lead with',
  optDateFormatRelative: 'How long ago',
  optDateFormatAbsolute: 'The exact date',
  /** Deliberately shows the shape rather than naming the standard. */
  optDateFormatIso: 'The exact date, as 2024-03-12',

  optDataHeading: 'Stored results',
  /** {1} = a count, {2} = a formatted size, e.g. "41 KB". */
  optCacheSummary: '{1} pages remembered, using {2}.',
  optCacheEmpty: 'Nothing stored.',
  optCacheHelp:
    'Results are kept for a week so re-opening a page is instant. They are stored on this device only, and never sent anywhere.',
  optCacheClear: 'Clear stored results',
  optCacheCleared: 'Cleared.',
} as const

export type MessageKey = keyof typeof MESSAGES

type I18nHost = {
  i18n?: {
    getMessage?: (key: string, subs?: string[]) => string
    getUILanguage?: () => string
  }
}

const host = (): I18nHost | undefined =>
  (globalThis as { browser?: I18nHost; chrome?: I18nHost }).browser ??
  (globalThis as { chrome?: I18nHost }).chrome

/**
 * The language the browser is showing this extension in, as a BCP 47 tag.
 *
 * Used to stamp `documentElement.lang`, which the static HTML cannot know. It
 * is not decoration: a screen reader picks its pronunciation rules from that
 * attribute, so a French panel left declaring `lang="en"` is read out with
 * English phonemes — which is worse than not being announced at all.
 */
export const uiLanguage = (): string => host()?.i18n?.getUILanguage?.() ?? 'en'

/**
 * Look up a translation, falling back to the English table.
 *
 * `getMessage` returns an empty string for a key the active locale has no
 * entry for, which is indistinguishable from a genuinely empty translation —
 * so an empty result is treated as a miss rather than rendered as blank UI.
 */
function translate(key: MessageKey): string | null {
  const found = host()?.i18n?.getMessage?.(key)
  return found ? found : null
}

/**
 * Placeholders are `{1}`, not Chrome's `$1`.
 *
 * `$`-syntax is substituted by `getMessage` itself, which would consume the
 * placeholder before this function ever sees it and make the two paths behave
 * differently. Braces are inert to the browser, so substitution happens in
 * exactly one place regardless of whether a translation was found.
 */
export function t(key: MessageKey, ...subs: string[]): string {
  const template = translate(key) ?? MESSAGES[key]
  return template.replace(/\{(\d)\}/g, (_, index: string) => subs[Number(index) - 1] ?? '')
}
