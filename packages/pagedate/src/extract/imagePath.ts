import type { Candidate } from '../types.js'

/**
 * The date baked into the path of the page's social preview image.
 *
 * WordPress files uploads under `/wp-content/uploads/2016/05/`, Drupal under
 * `/files/2016/05/04/`, and the image a post declares as its `og:image` is
 * almost always the one uploaded when the post was written. On the CMS-shaped
 * sites that emit no other date this is often the only machine-readable signal
 * present.
 *
 * Only a path carrying a **day** counts. That restriction is measured, not
 * cautious by temperament: of the six pages in the external corpus that declare
 * a dated image path, the two with a day (`/2016/05/04/`) name the page's real
 * date exactly, while three of the four with only a month name something else
 * — a monthly upload bucket holds every image a site used that month, including
 * the stock banner it has reused since. Accepting months added one hit and one
 * false positive; accepting only days adds a hit and costs nothing.
 *
 * It is `inferred` and ranks below the URL slug even so: an image is reusable
 * and a URL is not.
 */

/**
 * Keys whose content is a preview image. Matched against `property`, `name` and
 * `itemprop` alike, because sites use all three interchangeably for these.
 */
const IMAGE_KEYS = new Set([
  'og:image',
  'og:image:url',
  'og:image:secure_url',
  'twitter:image',
  'twitter:image:src',
])

/**
 * `/2016/05/04/` — a directory minted for one upload.
 *
 * The bare `/2016/05/` form is deliberately not matched: see the note above.
 */
const DATED_PATH_DAY = /\/((?:19|20)\d{2})\/(0[1-9]|1[0-2])\/(0[1-9]|[12]\d|3[01])(?:\/|$)/

export function extractImagePath(doc: Document): Candidate[] {
  for (const el of doc.querySelectorAll('meta')) {
    const key = (
      el.getAttribute('property') ??
      el.getAttribute('name') ??
      el.getAttribute('itemprop') ??
      ''
    )
      .trim()
      .toLowerCase()
    if (!IMAGE_KEYS.has(key)) continue

    // `content` is the standard; `value` appears often enough in the wild that
    // ignoring it would drop pages for a typo in someone's theme.
    const raw = (el.getAttribute('content') ?? el.getAttribute('value'))?.trim()
    if (!raw) continue

    const candidate = fromImageUrl(raw, key)
    // First match wins. Multiple image tags on a page are near-always the same
    // file declared three ways, and a second candidate would only be noise.
    if (candidate) return [candidate]
  }

  return []
}

function fromImageUrl(raw: string, key: string): Candidate | null {
  const path = pathOf(raw)
  if (!path) return null

  const day = DATED_PATH_DAY.exec(path)
  if (!day) return null

  const [, y, m, d] = day
  // Reject Feb 30 and friends: an upload path is not validated by anyone.
  const probe = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)))
  if (probe.getUTCDate() !== Number(d) || probe.getUTCMonth() !== Number(m) - 1) return null

  return build(`${y}-${m}-${d}`, key)
}

function build(value: string, key: string): Candidate {
  return {
    value,
    precision: 'day',
    field: 'published',
    source: 'image-path',
    confidence: 'inferred',
    note: `upload path of <meta> ${key}`,
  }
}

/**
 * The path portion, whether or not the URL is absolute.
 *
 * Preview images sit on a CDN as often as not — `i0.wp.com/example.com/...`
 * keeps the original path, so the host is irrelevant to us and its absence in a
 * relative URL is not a reason to give up.
 */
function pathOf(raw: string): string | null {
  try {
    return new URL(raw, 'https://placeholder.invalid').pathname
  } catch {
    return null
  }
}
