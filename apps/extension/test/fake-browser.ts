import { vi } from 'vitest'

/**
 * The slice of the extension API the storage and permission code touches.
 *
 * Hand-rolled rather than a library fake, because what these tests assert is
 * mostly *order* — which call came before which — and a single shared log is
 * the simplest thing that can show it.
 */
export function fakeBrowser(
  options: {
    stored?: Record<string, unknown>
    /** Patterns currently granted. A `contains` for several needs all of them. */
    granted?: string[]
    /** What the next `permissions.request` resolves to, or throws. */
    request?: boolean | Error
    /** Make `storage.local.set` fail this many times, as a full store does. */
    failSets?: number
  } = {},
) {
  const log: string[] = []
  const stored: Record<string, unknown> = { ...options.stored }
  const granted = new Set(options.granted ?? [])
  let failSets = options.failSets ?? 0

  const api = {
    runtime: { id: 'pagedate-test' },
    storage: {
      local: {
        get: async (key: string | null) => {
          if (key === null) return { ...stored }
          return key in stored ? { [key]: stored[key] } : {}
        },
        set: async (items: Record<string, unknown>) => {
          if (failSets > 0) {
            failSets--
            log.push('set:failed')
            throw new Error('QUOTA_BYTES quota exceeded')
          }
          log.push(`set:${Object.keys(items).join(',')}`)
          Object.assign(stored, structuredClone(items))
        },
        remove: async (keys: string | string[]) => {
          for (const key of [keys].flat()) delete stored[key]
          log.push('remove-keys')
        },
      },
    },
    permissions: {
      request: async ({ origins }: { origins: string[] }) => {
        log.push(`request:${origins.join(' ')}`)
        if (options.request instanceof Error) throw options.request
        if (options.request === false) return false
        for (const origin of origins) granted.add(origin)
        return true
      },
      remove: async ({ origins }: { origins: string[] }) => {
        log.push(`revoke:${origins.join(' ')}`)
        for (const origin of origins) granted.delete(origin)
        return true
      },
      contains: async ({ origins }: { origins: string[] }) =>
        origins.every((origin) => granted.has(origin) || granted.has('*://*/*')),
    },
    tabs: { query: async () => [{ id: 1 }, { id: 2 }] },
    action: {
      setBadgeText: async ({ tabId }: { tabId: number }) => {
        log.push(`badge:${tabId}`)
      },
    },
    scripting: {
      executeScript: vi.fn(async ({ target }: { target: { tabId: number } }) => {
        // Removing an overlay is an injection, which needs the grant.
        if (!granted.has('*://*/*')) throw new Error('Cannot access contents of the page')
        log.push(`inject:${target.tabId}`)
        return [{ result: undefined }]
      }),
    },
  }

  return { api, log, stored, granted }
}
