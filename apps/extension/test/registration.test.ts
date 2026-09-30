import { describe, expect, it } from 'vitest'
import { registrationPlan } from '../lib/registration.js'

const wanted = { matches: ['*://duckduckgo.com/*', '*://*.bing.com/search*'], js: ['content-scripts/annotate.js'] }

/**
 * The background worker starts on almost any event in MV3, including the
 * navigation to a results page. When every start unregistered the annotator
 * and registered it again, that navigation raced a window with nothing
 * registered. The registration is now left alone unless it is wrong.
 */
describe('registrationPlan', () => {
  it('leaves a correct registration untouched', () => {
    expect(registrationPlan({ id: 'a', ...wanted }, wanted)).toBe('keep')
  })

  it('does not care what order the browser lists the matches in', () => {
    const existing = { id: 'a', js: wanted.js, matches: [...wanted.matches].reverse() }
    expect(registrationPlan(existing, wanted)).toBe('keep')
  })

  it('accepts the browser’s own spelling of the script path', () => {
    for (const path of ['/content-scripts/annotate.js', 'moz-extension://abc/content-scripts/annotate.js']) {
      expect(registrationPlan({ id: 'a', matches: wanted.matches, js: [path] }, wanted)).toBe('keep')
    }
  })

  it('registers when nothing is there', () => {
    expect(registrationPlan(undefined, wanted)).toBe('register')
  })

  it('replaces a registration whose matches have changed', () => {
    const existing = { id: 'a', js: wanted.js, matches: ['*://duckduckgo.com/*'] }
    expect(registrationPlan(existing, wanted)).toBe('replace')
  })

  it('unregisters when the feature is off or its grant is gone', () => {
    expect(registrationPlan({ id: 'a', ...wanted }, null)).toBe('unregister')
  })

  it('does nothing when it is off and nothing is registered', () => {
    expect(registrationPlan(undefined, null)).toBe('keep')
  })
})
