import { describeError } from '../errors'
import { loadLock, mustLock, saveLock } from '../lock'
import type { Services } from './services'
import type { AppStore } from './store'

const TITLE = 'Peregrine entsperren'
const DESCRIPTION = 'Gib die Bildschirmsperre dieses Telefons ein.'

/**
 * Locking the application with the screen lock of the phone.
 *
 * It is locked when it starts, and when it comes back after being away for as long as was set. While it is locked the screens show nothing of the mail;
 * the application goes on behind, so what arrives is fetched and the queue runs. It is opened by the screen lock of the phone, which the system asks for,
 * so the application keeps no secret of its own.
 */
export class LockController {
  /** When the application went away, or null when it has not since it was last open. */
  private leftAt: number | null = null
  /** The system is asking for the lock. The application goes into the background for that, which is not it being away. */
  private asking = false

  constructor(
    private readonly services: Services,
    private readonly store: AppStore,
    private readonly now: () => number = Date.now
  ) {}

  /** At the start: locked when it is on, which it is before anything is shown. */
  async start(): Promise<void> {
    const settings = await loadLock(this.services.db)
    await this.secure(settings.enabled)
    if (settings.enabled) this.store.setLocked(true)
  }

  /** The application went away: the moment is noted. */
  wentAway(): void {
    if (!this.asking) this.leftAt = this.now()
  }

  /** The application came back: it is locked when it was away for long enough, and the lock is asked for at once when it is locked. */
  async cameBack(): Promise<void> {
    if (this.asking) return
    const settings = await loadLock(this.services.db)
    if (mustLock(settings, this.leftAt, this.now())) this.store.setLocked(true)
    this.leftAt = null
    if (this.store.state.locked) await this.unlock()
  }

  /** Asks for the screen lock of the phone, and opens the application when it is given. Says whether it was. */
  async unlock(): Promise<boolean> {
    if (this.asking) return false
    this.asking = true
    try {
      const given = await this.services.deviceLock.authenticate(TITLE, DESCRIPTION)
      if (given) {
        this.store.setLocked(false)
        this.leftAt = null
      }
      return given
    } catch (error) {
      this.services.log.error(`the screen lock could not be asked for: ${describeError(error)}`)
      return false
    } finally {
      this.asking = false
    }
  }

  /**
   * Switches the lock on or off. Both ask for the screen lock: on to prove that it works before the application depends on it, and off so that
   * whoever has the unlocked phone cannot take it away. Returns what is to be said, or nothing when it was done.
   */
  async setEnabled(enabled: boolean): Promise<string | undefined> {
    if (enabled && !(await this.services.deviceLock.available())) {
      return 'Dieses Telefon hat keine Bildschirmsperre. Richte in den Systemeinstellungen eine ein, dann lässt sich die App sperren.'
    }
    if (!(await this.ask())) return enabled ? 'Die Sperre wurde nicht bestätigt und bleibt aus.' : 'Die Sperre wurde nicht bestätigt und bleibt an.'
    await saveLock(this.services.db, { enabled })
    await this.secure(enabled)
    return undefined
  }

  /** The time the application may be away before it asks again. */
  async setDelay(afterSeconds: number): Promise<void> {
    await saveLock(this.services.db, { afterSeconds })
  }

  private async ask(): Promise<boolean> {
    this.asking = true
    try {
      return await this.services.deviceLock.authenticate(TITLE, DESCRIPTION)
    } catch (error) {
      this.services.log.error(`the screen lock could not be asked for: ${describeError(error)}`)
      return false
    } finally {
      this.asking = false
    }
  }

  private async secure(on: boolean): Promise<void> {
    try {
      await this.services.deviceLock.setSecure(on)
    } catch (error) {
      this.services.log.error(`the screens could not be kept out of screenshots: ${describeError(error)}`)
    }
  }
}
