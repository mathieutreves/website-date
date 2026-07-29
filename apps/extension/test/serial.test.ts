import { describe, expect, it } from 'vitest'

/**
 * The queue that keeps the background worker's two registration syncs from
 * racing each other.
 *
 * Reproduced here rather than imported, because `background.ts` is a
 * `defineBackground` entrypoint whose body only runs inside a browser. The
 * function is six lines and the bug it fixes is not obvious from reading them,
 * so the behaviour is pinned even though the copy is.
 *
 * The bug it fixes, in the real thing: `syncMenu` is triggered from four places
 * — install, startup, a settings change, and worker start — and its body is
 * `await removeAll()` then `create()`. Two overlapping calls both await their
 * removal, then both create, and Chrome logs
 * `Cannot create item with duplicate id pagedate-check-link`. `await` inside the
 * function cannot help: the interleaving is between invocations.
 */
function serial(): (task: () => Promise<void>) => Promise<void> {
  let queue: Promise<void> = Promise.resolve()
  return (task) => {
    queue = queue.then(task).catch(() => {})
    return queue
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('serial', () => {
  it('never overlaps two tasks, however they are launched', async () => {
    const run = serial()
    let live = 0
    let overlapped = false

    const task = async () => {
      live++
      if (live > 1) overlapped = true
      await tick()
      live--
    }

    // Fired the way the worker fires them: several times, without awaiting.
    await Promise.all([run(task), run(task), run(task), run(task)])

    expect(overlapped).toBe(false)
  })

  /*
   * The exact shape of the duplicate-id bug: teardown, then setup, interleaved.
   * Without the queue this yields remove, remove, create, create.
   */
  it('keeps a teardown-then-setup pair intact', async () => {
    const run = serial()
    const log: string[] = []

    const sync = async () => {
      log.push('remove')
      await tick()
      log.push('create')
    }

    await Promise.all([run(sync), run(sync)])

    expect(log).toEqual(['remove', 'create', 'remove', 'create'])
  })

  it('runs tasks in the order they were queued', async () => {
    const run = serial()
    const log: number[] = []

    await Promise.all(
      [1, 2, 3].map((n) =>
        run(async () => {
          await tick()
          log.push(n)
        }),
      ),
    )

    expect(log).toEqual([1, 2, 3])
  })

  /*
   * A rejected task must not wedge every later one behind it. The worker calls
   * these on every settings change for the life of the profile, so one failure
   * that poisoned the chain would disable the feature until a restart.
   *
   * It must also not hand a rejecting promise back: every call site is
   * `void syncMenu()`, so a rejection there is an unhandled one.
   */
  it('keeps going after a task throws', async () => {
    const run = serial()
    const log: string[] = []

    const failing = run(async () => {
      throw new Error('removeAll failed')
    })
    const after = run(async () => {
      log.push('ran anyway')
    })

    await expect(failing).resolves.toBeUndefined()
    await after
    expect(log).toEqual(['ran anyway'])
  })
})
