import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The popup's width, guarded.
 *
 * Nothing else in this suite can see this bug: the view layer returns correct
 * HTML, every assertion passes, and the panel still renders 90px wide with one
 * word per line. A desktop popup sizes itself from its content before it has a
 * viewport, so a viewport-relative width on `body` clamps the box against a
 * measurement that has not happened yet and the popup settles at whatever that
 * produced.
 *
 * Reading the stylesheet as text is crude, but it asserts the one property that
 * a headless DOM cannot reproduce and a screenshot catches only after shipping.
 */

const CSS = readFileSync(
  join(import.meta.dirname, '..', 'entrypoints', 'popup', 'style.css'),
  'utf8',
)

/**
 * The stylesheet with comments and every `@media` block removed: the rules that
 * apply unconditionally. Comments go first — this file explains the rule it is
 * enforcing, and prose about `100vw` is not a declaration of it.
 */
const unconditional = stripAtRules(CSS.replace(/\/\*[\s\S]*?\*\//g, ''))

function stripAtRules(css: string): string {
  let out = ''
  for (let i = 0; i < css.length; i++) {
    if (!css.startsWith('@media', i)) {
      out += css[i]
      continue
    }
    // Skip to the matching close brace, counting nesting on the way.
    let depth = 0
    for (; i < css.length; i++) {
      if (css[i] === '{') depth++
      else if (css[i] === '}' && --depth === 0) break
    }
  }
  return out
}

describe('popup width', () => {
  it('sets an absolute width on body', () => {
    expect(unconditional).toMatch(/body\s*\{[^}]*\bwidth:\s*360px/)
  })

  it('never sizes the popup in viewport units outside a touch query', () => {
    expect(unconditional).not.toMatch(/\d+(?:\.\d+)?v(?:w|h|min|max)\b/)
  })

  it('keeps the mobile clamp, under pointer: coarse', () => {
    const coarse = CSS.slice(CSS.indexOf('@media (pointer: coarse)'))
    expect(coarse).toMatch(/body\s*\{[^}]*max-width:\s*100vw/)
  })
})
