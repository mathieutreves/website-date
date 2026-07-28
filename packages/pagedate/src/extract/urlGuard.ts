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

  const host = parsed.hostname.toLowerCase()
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
 * IPv6, including the two forms that carry an IPv4 address inside them.
 *
 * `::ffff:127.0.0.1` and `64:ff9b::7f00:1` both reach 127.0.0.1 on a
 * dual-stack host, so blocking v4 loopback while allowing its v6 spelling would
 * be a filter with a documented hole in it.
 */
function isPrivateV6(host: string): boolean {
  const address = host.split('%')[0]!.toLowerCase() // strip any zone index
  if (address === '::' || address === '::1') return true

  // Unique-local (fc00::/7), link-local (fe80::/10), multicast (ff00::/8).
  if (/^f[cd]/.test(address)) return true
  if (/^fe[89ab]/.test(address)) return true
  if (address.startsWith('ff')) return true

  const embedded = embeddedV4(address)
  return embedded !== null && isPrivateV4(embedded)
}

/** The IPv4 address inside an IPv4-mapped or NAT64 IPv6 address, if there is one. */
function embeddedV4(address: string): number | null {
  const mapped = /^::ffff:(.+)$/.exec(address) ?? /^64:ff9b::(.+)$/.exec(address)
  if (!mapped) return null

  const tail = mapped[1]!
  // Either written as dotted quad (`::ffff:127.0.0.1`) or as two hex groups
  // (`::ffff:7f00:1`), and both spell the same address.
  const dotted = parseV4(tail)
  if (dotted !== null) return dotted

  const groups = tail.split(':')
  if (groups.length !== 2) return null
  const high = Number.parseInt(groups[0]!, 16)
  const low = Number.parseInt(groups[1]!, 16)
  if (!Number.isInteger(high) || !Number.isInteger(low)) return null
  if (high > 0xffff || low > 0xffff || high < 0 || low < 0) return null
  return (high * 0x10000 + low) >>> 0
}
