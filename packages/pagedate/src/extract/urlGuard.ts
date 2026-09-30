/**
 * Which URLs this library is willing to fetch.
 *
 * Feed and sitemap discovery read `<link rel="alternate">`, `<link rel="sitemap">`
 * and `<loc>` — all of which the *analysed page* writes. That is the correct
 * design (a site knows where its own feed lives) with one consequence: the page
 * chooses what the host running this library connects to. Unguarded, a document
 * only has to declare
 *
 *     <link rel="sitemap" href="http://169.254.169.254/latest/meta-data/">
 *
 * to have a server dutifully fetch its own cloud credentials endpoint. Response
 * bodies never reach the caller, but reachability, timing, and any
 * `<lastmod>`-shaped bytes in the reply do.
 *
 * The rule is **public hosts only**, not same-origin. Feeds legitimately live
 * off-origin — FeedBurner, Substack — and refusing those would cost real
 * accuracy to solve a problem private-address filtering already solves. What is
 * blocked is the part of the address space a page has no business pointing a
 * server at: loopback, link-local, RFC 1918, cloud metadata, and everything that
 * is not HTTP.
 *
 * Note what this deliberately does *not* claim. A hostname resolving to a
 * private address passes here, because this test never resolves DNS — see
 * {@link https://en.wikipedia.org/wiki/DNS_rebinding}. `nodeEnv`'s
 * `blockPrivateNetwork: 'strict'` adds a resolution check; even that is a
 * preflight, not a pin. Callers on a genuinely hostile network should inject
 * their own `Env`.
 */

/**
 * The filter the feed and sitemap lookups apply to a URL the page declared:
 * {@link isSafeFetchTarget}, or the scheme test alone for an `Env` that has
 * opted into the private network.
 */
export function isDeclaredTargetAllowed(url: URL, env: { allowPrivateNetwork?: boolean }): boolean {
  if (!env.allowPrivateNetwork) return isSafeFetchTarget(url)
  return (url.protocol === 'http:' || url.protocol === 'https:') && url.username === '' && url.password === ''
}

/** Suffixes that name something on the local machine or local network. */
const LOCAL_SUFFIXES = ['.localhost', '.local', '.internal', '.home.arpa']

export function isSafeFetchTarget(url: string | URL): boolean {
  let parsed: URL
  try {
    parsed = typeof url === 'string' ? new URL(url) : url
  } catch {
    return false
  }

  // `file:` reads the analysing machine's disk, `data:` and `javascript:` are
  // not fetches at all, and `gopher:`/`ftp:` are classic request-smuggling
  // primitives. Nothing but the two web schemes has a reason to appear here.
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false

  // Credentials in a page-supplied URL would be sent to whatever host the page
  // named. There is no legitimate `<link rel="sitemap" href="http://u:p@…">`.
  if (parsed.username !== '' || parsed.password !== '') return false

  // A trailing dot is the fully-qualified spelling of the same name, and `URL`
  // strips it only from IP literals: `localhost.` and `metadata.google.internal.`
  // arrive here intact, equal to nothing below and ending in no blocked suffix.
  const host = parsed.hostname.toLowerCase().replace(/\.+$/, '')
  if (host === '') return false

  if (host === 'localhost' || LOCAL_SUFFIXES.some((suffix) => host.endsWith(suffix))) return false

  // A single-label name resolves through the resolver's search domain, which on
  // a corporate network is exactly the set of hosts worth protecting.
  const bracketed = host.startsWith('[')
  if (!bracketed && !host.includes('.')) return false

  if (bracketed) return !isPrivateV6(host.slice(1, -1))

  const v4 = parseV4(host)
  // Not an IP literal: a public DNS name, which is allowed.
  if (v4 === null) return true
  return !isPrivateV4(v4)
}

/**
 * Dotted-quad to a 32-bit integer, or `null` if the host is not an IPv4 literal.
 *
 * Only the canonical form needs handling because `URL` has already normalised
 * the alternatives: the parser accepts octal, hexadecimal and bare-integer
 * addresses and rewrites them, so `http://0177.0.0.1/`, `http://0x7f.1/` and
 * `http://2130706433/` all arrive here as `127.0.0.1`. Those are the usual way
 * a naive dotted-quad check gets walked past; here they are already gone.
 */
function parseV4(host: string): number | null {
  const parts = host.split('.')
  if (parts.length !== 4) return null

  let value = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const octet = Number(part)
    if (octet > 255) return null
    value = value * 256 + octet
  }
  return value
}

/** CIDR blocks that are not reachable, not routable, or not anyone else's. */
const PRIVATE_V4_BLOCKS: ReadonlyArray<readonly [string, number]> = [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // RFC 1918
  ['100.64.0.0', 10], // RFC 6598 carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local — cloud instance metadata lives at 169.254.169.254
  ['172.16.0.0', 12], // RFC 1918
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.168.0.0', 16], // RFC 1918
  ['198.18.0.0', 15], // benchmarking
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, including 255.255.255.255
]

function isPrivateV4(address: number): boolean {
  return PRIVATE_V4_BLOCKS.some(([network, bits]) => {
    const mask = bits === 0 ? 0 : (-1 << (32 - bits)) >>> 0
    return (address & mask) >>> 0 === (parseV4(network)! & mask) >>> 0
  })
}

/**
 * IPv6, including the forms that carry an IPv4 address inside them.
 *
 * `::ffff:127.0.0.1` and `64:ff9b::7f00:1` both reach 127.0.0.1 on a
 * dual-stack host, so blocking v4 loopback while allowing its v6 spelling would
 * be a filter with a documented hole in it. The same goes for the 6to4 and
 * IPv4-translated spellings, which need NAT64 or 6to4 routing to go anywhere
 * but go to the embedded address when they do.
 *
 * Judged on the eight expanded groups rather than on the string, because one
 * address has many spellings and a prefix test on text only recognises the one
 * it was written against. An address that will not expand is refused.
 */
function isPrivateV6(host: string): boolean {
  const g = expandV6(host.split('%')[0]!.toLowerCase()) // strip any zone index
  if (!g) return true

  const v4 = (high: number, low: number): number => (high * 0x10000 + low) >>> 0
  const zero = (from: number, to: number): boolean => g.slice(from, to).every((x) => x === 0)

  // ::/96 — unspecified, loopback, and the deprecated IPv4-compatible range.
  if (zero(0, 6)) return true
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-translated (::ffff:0:a.b.c.d).
  if (zero(0, 5) && g[5] === 0xffff) return isPrivateV4(v4(g[6]!, g[7]!))
  if (zero(0, 4) && g[4] === 0xffff && g[5] === 0) return isPrivateV4(v4(g[6]!, g[7]!))
  // NAT64: the well-known prefix carries a v4 address, the local-use one
  // (64:ff9b:1::/48) is private by definition.
  if (g[0] === 0x64 && g[1] === 0xff9b) {
    if (g[2] === 1) return true
    if (zero(2, 6)) return isPrivateV4(v4(g[6]!, g[7]!))
  }
  // 6to4 (2002::/16) embeds the v4 address in the next two groups.
  if (g[0] === 0x2002) return isPrivateV4(v4(g[1]!, g[2]!))

  // Unique-local (fc00::/7), link-local (fe80::/10), the deprecated site-local
  // range (fec0::/10), multicast (ff00::/8).
  const first = g[0]!
  if ((first & 0xfe00) === 0xfc00) return true
  if ((first & 0xff80) === 0xfe80 || (first & 0xffc0) === 0xfec0) return true
  return (first & 0xff00) === 0xff00
}

/** An IPv6 address as eight 16-bit groups, or `null` if it is not one. */
function expandV6(address: string): number[] | null {
  let text = address

  // A dotted-quad tail is two groups written in the other notation.
  const dot = /^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text)
  if (dot) {
    const quad = parseV4(dot[2]!)
    if (quad === null) return null
    text = `${dot[1]}${(quad >>> 16).toString(16)}:${(quad & 0xffff).toString(16)}`
  }

  const halves = text.split('::')
  if (halves.length > 2) return null
  const parse = (part: string): number[] | null => {
    if (part === '') return []
    const out: number[] = []
    for (const group of part.split(':')) {
      if (!/^[0-9a-f]{1,4}$/.test(group)) return null
      out.push(Number.parseInt(group, 16))
    }
    return out
  }

  const head = parse(halves[0]!)
  const tail = halves.length === 2 ? parse(halves[1]!) : []
  if (!head || !tail) return null

  if (halves.length === 1) return head.length === 8 ? head : null
  const gap = 8 - head.length - tail.length
  if (gap < 1) return null
  return [...head, ...new Array<number>(gap).fill(0), ...tail]
}
