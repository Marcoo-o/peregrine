import { useEffect, useRef } from 'react'
import { useSettingsStore } from '@renderer/state/settingsStore'

/**
 * Locks the profile again after a stretch of doing nothing.
 *
 * Only meaningful for an encrypted profile: locking an unencrypted one would close a door
 * that anyone can walk straight back through, which is why the setting is offered only where
 * it protects something.
 *
 * The timer is reset by real input rather than by a periodic tick, so a window left open
 * with a video playing still locks. What matters is whether a person is there.
 */
const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'wheel', 'touchstart', 'focus'] as const

interface IdleLockProps {
  /** Without encryption there is nothing to lock, so the timer stays off. */
  enabled: boolean
}

function IdleLock({ enabled }: IdleLockProps): null {
  const autoLockMinutes = useSettingsStore((s) => s.settings.autoLockMinutes)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!enabled || autoLockMinutes <= 0) return

    const lock = (): void => {
      void window.peregrine.profiles.lock()
    }
    const reset = (): void => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(lock, autoLockMinutes * 60_000)
    }

    reset()
    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, reset, { passive: true, capture: true })
    }
    return () => {
      if (timer.current) clearTimeout(timer.current)
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, reset, { capture: true })
      }
    }
  }, [enabled, autoLockMinutes])

  return null
}

export default IdleLock
