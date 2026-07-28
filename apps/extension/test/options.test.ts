import { describe, expect, it } from 'vitest'
import { DEFAULTS, type Settings } from '../lib/settings.js'
import { formatBytes, optionsView } from '../entrypoints/options/render.js'

const view = (over: Partial<Settings> = {}, stats = { count: 0, bytes: 0 }): string =>
  optionsView({ ...DEFAULTS, ...over }, stats)

describe('defaults', () => {
  it('starts with everything that widens access switched off', () => {
    // The extension asks for nothing at install time. That only holds if the
    // defaults are the privacy-preserving answer in every case.
    expect(DEFAULTS.autoRead).toBe(false)
    expect(DEFAULTS.archive).toBe('off')
  })
})

describe('what each setting says it costs', () => {
  it('states the cost of reading every page in the reader’s terms', () => {
    const html = view()
    expect(html).toContain('read every site you visit')
    // Never the manifest's vocabulary.
    expect(html).not.toContain('all_urls')
  })

  it('says what the archive learns about you', () => {
    expect(view()).toContain('tells them the address of the page you are on')
  })

  it('leads with the promise the defaults keep', () => {
    const html = view()
    expect(html.indexOf('asks for nothing at install time')).toBeLessThan(
      html.indexOf('optAutoRead' in DEFAULTS ? 'x' : 'Check every page'),
    )
  })
})

describe('controls reflect stored state', () => {
  it('checks the boxes that are on', () => {
    expect(view({ autoRead: true })).toMatch(/id="auto-read"[^>]*checked/)
    expect(view({ autoRead: false })).not.toMatch(/id="auto-read"[^>]*checked/)
  })

  it('selects the stored archive mode', () => {
    expect(view({ archive: 'always' })).toMatch(/value="always"[^>]*checked/)
    expect(view({ archive: 'always' })).not.toMatch(/value="off"[^>]*checked/)
  })

  it('uses real radios and checkboxes, not div-based fakes', () => {
    // A settings page is the last place to lose keyboard and screen-reader
    // behaviour in exchange for styling.
    const html = view()
    expect(html).toContain('<input type="checkbox"')
    expect(html).toContain('<input type="radio"')
  })
})

describe('stored results', () => {
  it('says nothing is stored rather than showing a zero', () => {
    const html = view({}, { count: 0, bytes: 0 })
    expect(html).toContain('Nothing stored')
    expect(html).toMatch(/id="clear-cache"[^>]*disabled/)
  })

  it('reports what is there, and enables clearing it', () => {
    const html = view({}, { count: 12, bytes: 41_984 })
    expect(html).toContain('12 pages remembered, using 41 KB')
    expect(html).not.toMatch(/id="clear-cache"[^>]*disabled/)
  })

  it('scales units so the figure stays readable', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(41_984)).toBe('41 KB')
    expect(formatBytes(3_500_000)).toBe('3.3 MB')
  })
})
