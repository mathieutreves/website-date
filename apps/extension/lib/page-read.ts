import type { Candidate } from 'pagedate'

/**
 * The contract between the injected extractor and whoever injected it.
 *
 * Kept in its own module, importing only a *type* from the library, so that the
 * background can talk about the shape of a page read without pulling the
 * extractor — and the ~36 KB of pattern tables behind it — into the service
 * worker bundle. `entrypoints/extract.ts` imports the real thing; everything
 * else imports this.
 */

/**
 * Where the injected script leaves its result for the follow-up read.
 *
 * A global rather than the injection's return value, which sounds like the
 * long way round and is the reliable one. `executeScript({ files })` resolves
 * to the last evaluated statement of the bundle, and what that statement *is*
 * depends on the module format the bundler happened to emit — for WXT's
 * unlisted scripts it is a promise wrapper whose value is not the script's own
 * return. Stashing it under a known key and reading it back is independent of
 * all of that.
 *
 * Both injections land in the same isolated world for the frame, so the key is
 * visible to the second and invisible to the page itself.
 */
export const PAGE_READ_GLOBAL = '__pagedatePageRead'

export type PageRead = {
  candidates: Candidate[]
  /**
   * The URL the DOM was actually read from.
   *
   * Carried back so the caller can prove the read belongs to the page it asked
   * about. On a single-page app the URL changes before the new view renders, so
   * a read fired on navigation can return the previous route's candidates —
   * which would then be cached under the new URL and served as fact for a week.
   */
  href: string
}
