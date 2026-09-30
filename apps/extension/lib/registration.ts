/**
 * Deciding what to do about a runtime content-script registration.
 *
 * The background worker used to unregister and re-register the annotator every
 * time it started, on the reasoning that a worker which is evicted freely
 * cannot trust its own memory of what it registered. That reasoning is right
 * and the conclusion was wrong: the browser remembers, and can be asked. In
 * MV3 the worker starts on almost any event — including the navigation to a
 * results page — so tearing the registration down on every start put a window
 * with no script registered exactly where the script was about to be needed.
 *
 * So the registration is compared with what is wanted and touched only when
 * they differ. Pure, so the four outcomes are testable without a browser.
 */

export type Registered = { id: string; matches?: string[] | undefined; js?: string[] | undefined }

export type RegistrationPlan = 'keep' | 'register' | 'unregister' | 'replace'

const sameSet = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((value) => b.includes(value))

/** Browsers hand paths back in their own spelling: relative, rooted, or a full extension URL. */
const samePath = (a: string, b: string): boolean => {
  const bare = (path: string) => path.replace(/^\/+/, '')
  return bare(a).endsWith(bare(b)) || bare(b).endsWith(bare(a))
}

export function registrationPlan(
  existing: Registered | undefined,
  wanted: { matches: string[]; js: string[] } | null,
): RegistrationPlan {
  if (!wanted) return existing ? 'unregister' : 'keep'
  if (!existing) return 'register'

  const js = existing.js ?? []
  const current =
    sameSet(existing.matches ?? [], wanted.matches) &&
    js.length === wanted.js.length &&
    js.every((path, index) => samePath(path, wanted.js[index]!))

  return current ? 'keep' : 'replace'
}
