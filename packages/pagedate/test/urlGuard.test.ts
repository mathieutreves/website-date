import { describe, expect, it } from 'vitest'
import { isSafeFetchTarget } from '../src/extract/urlGuard.js'

/**
 * The address filter that stands between a page's `<link rel="sitemap">` and the
 * analysing host's network.
 *
 * Table-driven because the value of this function is entirely in its edges: the
 * interesting cases are the spellings of `127.0.0.1` that do not look like
 * `127.0.0.1`, and each of them is one line here.
 */

describe('isSafeFetchTarget', () => {
  describe('allows ordinary public web addresses', () => {
    const allowed = [
      'https://example.com/sitemap.xml',
      'http://example.com/feed/',
      // Off-origin feed hosts are the reason this is an address filter and not a
      // same-origin rule.
      'https://feeds.feedburner.com/example',
      'https://example.substack.com/feed',
      'https://example.com:8443/sitemap.xml',
      'https://xn--bcher-kva.example/feed.xml',
      // Public addresses that merely sit near a private block.
      'http://9.255.255.255/',
      'http://11.0.0.1/',
      'http://172.32.0.1/',
      'http://192.169.0.1/',
      'http://169.253.0.1/',
      'http://[2606:4700::1111]/',
    ]

    for (const url of allowed) {
      it(url, () => expect(isSafeFetchTarget(url)).toBe(true))
    }
  })

  describe('refuses anything that is not an HTTP fetch', () => {
    const refused = [
      'file:///etc/passwd',
      'data:text/xml,<urlset/>',
      'javascript:alert(1)',
      'ftp://example.com/feed.xml',
      'gopher://example.com:6379/_SET%20foo%20bar',
      'not a url at all',
      '',
    ]

    for (const url of refused) {
      it(url || '(empty string)', () => expect(isSafeFetchTarget(url)).toBe(false))
    }
  })

  it('refuses credentials, which would be handed to whatever host the page named', () => {
    expect(isSafeFetchTarget('http://user:pass@example.com/feed')).toBe(false)
    expect(isSafeFetchTarget('http://user@example.com/feed')).toBe(false)
  })

  describe('refuses the private and unroutable address space', () => {
    const refused: Array<[string, string]> = [
      ['http://127.0.0.1/', 'loopback'],
      ['http://127.1.2.3/', 'loopback, whole /8'],
      ['http://10.0.0.1/', 'RFC 1918'],
      ['http://172.16.0.1/', 'RFC 1918'],
      ['http://172.31.255.255/', 'RFC 1918, top of the /12'],
      ['http://192.168.1.1/', 'RFC 1918'],
      ['http://169.254.169.254/latest/meta-data/', 'cloud instance metadata'],
      ['http://100.64.0.1/', 'carrier-grade NAT'],
      ['http://0.0.0.0/', 'this network'],
      ['http://192.0.0.1/', 'IETF protocol assignments'],
      ['http://198.18.0.1/', 'benchmarking'],
      ['http://224.0.0.1/', 'multicast'],
      ['http://255.255.255.255/', 'broadcast'],
    ]

    for (const [url, why] of refused) {
      it(`${url} — ${why}`, () => expect(isSafeFetchTarget(url)).toBe(false))
    }
  })

  describe('refuses the alternative spellings of a private address', () => {
    // These are the classic way past a naive dotted-quad check. They pass here
    // because `URL` normalises them back to dotted decimal before this function
    // ever sees them — worth asserting precisely because it is someone else's
    // behaviour that the guard is relying on.
    const refused: Array<[string, string]> = [
      ['http://2130706433/', 'decimal 127.0.0.1'],
      ['http://0x7f000001/', 'hexadecimal'],
      ['http://0177.0.0.1/', 'octal first octet'],
      ['http://127.1/', 'short form'],
      ['http://[::1]/', 'IPv6 loopback'],
      ['http://[::]/', 'IPv6 unspecified'],
      ['http://[fe80::1]/', 'IPv6 link-local'],
      ['http://[fd00::1]/', 'IPv6 unique-local'],
      ['http://[::ffff:127.0.0.1]/', 'IPv4-mapped, dotted'],
      ['http://[::ffff:7f00:1]/', 'IPv4-mapped, hex groups'],
      ['http://[64:ff9b::7f00:1]/', 'NAT64-embedded loopback'],
    ]

    for (const [url, why] of refused) {
      it(`${url} — ${why}`, () => expect(isSafeFetchTarget(url)).toBe(false))
    }
  })

  describe('refuses names that only resolve on the local network', () => {
    const refused = [
      'http://localhost/',
      'http://LOCALHOST/',
      'http://api.localhost/',
      'http://printer.local/',
      'http://vault.internal/',
      'http://router.home.arpa/',
      // A single-label name goes through the resolver's search domain, which on
      // a corporate network is exactly the set worth protecting.
      'http://intranet/',
      'http://wiki:8080/',
    ]

    for (const url of refused) {
      it(url, () => expect(isSafeFetchTarget(url)).toBe(false))
    }
  })

  it('accepts a URL object as well as a string', () => {
    expect(isSafeFetchTarget(new URL('https://example.com/feed'))).toBe(true)
    expect(isSafeFetchTarget(new URL('http://127.0.0.1/feed'))).toBe(false)
  })
})
