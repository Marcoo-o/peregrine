import { app, screen, type BrowserWindow, type Rectangle } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Remembers where the window was and how big it was.
 *
 * Kept in its own file rather than in the settings table: this is not something the user
 * configures, it is something the app observes. Mixing it into the settings would also mean
 * a write on every window drag, on the same database the mail sync is using.
 */

interface WindowState extends Partial<Rectangle> {
  maximized?: boolean
}

/** Below this the three columns no longer fit side by side without the reader collapsing. */
const MIN_WIDTH = 940
const MIN_HEIGHT = 620

/**
 * First-run size. Deliberately generous: the reading pane sits under the message list, so a
 * short window leaves the message itself with a few lines of room. Which is exactly what a
 * fixed 800px default did.
 */
const PREFERRED_WIDTH = 1500
const PREFERRED_HEIGHT = 980

/** Share of the work area the window may take up when the screen is smaller than preferred. */
const SCREEN_FRACTION = 0.9

function stateFile(): string {
  return join(app.getPath('userData'), 'window-state.json')
}

function readState(): WindowState {
  try {
    return JSON.parse(readFileSync(stateFile(), 'utf8')) as WindowState
  } catch {
    return {}
  }
}

/**
 * Whether the remembered rectangle still lands on a screen that exists.
 *
 * A window restored onto a monitor that has since been unplugged is invisible but perfectly
 * alive. The app looks like it failed to start. Requiring the top edge to be visible is
 * enough: from there the window can always be dragged back.
 */
function isOnAScreen(bounds: Rectangle): boolean {
  return screen.getAllDisplays().some(({ workArea }) => {
    const titleBarY = bounds.y
    return (
      titleBarY >= workArea.y - 8 &&
      titleBarY < workArea.y + workArea.height &&
      bounds.x + bounds.width > workArea.x &&
      bounds.x < workArea.x + workArea.width
    )
  })
}

export interface InitialWindowBounds {
  width: number
  height: number
  x?: number
  y?: number
  maximized: boolean
  minWidth: number
  minHeight: number
}

export function initialWindowBounds(): InitialWindowBounds {
  const state = readState()
  const { workArea } = screen.getPrimaryDisplay()

  if (
    state.width != null &&
    state.height != null &&
    state.x != null &&
    state.y != null &&
    isOnAScreen(state as Rectangle)
  ) {
    return {
      width: Math.max(MIN_WIDTH, state.width),
      height: Math.max(MIN_HEIGHT, state.height),
      x: state.x,
      y: state.y,
      maximized: state.maximized === true,
      minWidth: MIN_WIDTH,
      minHeight: MIN_HEIGHT
    }
  }

  return {
    width: Math.min(PREFERRED_WIDTH, Math.round(workArea.width * SCREEN_FRACTION)),
    height: Math.min(PREFERRED_HEIGHT, Math.round(workArea.height * SCREEN_FRACTION)),
    maximized: state.maximized === true,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT
  }
}

const SAVE_DELAY_MS = 400

/**
 * Writes the state back when the window settles.
 *
 * Resizing fires continuously, so the write is debounced. The size is read from
 * `getNormalBounds`, which reports the restored geometry even while maximised. Otherwise
 * un-maximising after a restart would drop the window to full-screen size.
 */
export function trackWindowState(win: BrowserWindow): void {
  let timer: NodeJS.Timeout | null = null

  const save = (): void => {
    if (win.isDestroyed()) return
    const bounds = win.getNormalBounds()
    try {
      writeFileSync(
        stateFile(),
        JSON.stringify({ ...bounds, maximized: win.isMaximized() }, null, 2)
      )
    } catch (err) {
      // Not being able to remember the window position must never stop the app.
      console.error('saving window state failed:', err instanceof Error ? err.message : err)
    }
  }

  const scheduleSave = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(save, SAVE_DELAY_MS)
    timer.unref?.()
  }

  win.on('resize', scheduleSave)
  win.on('move', scheduleSave)
  win.on('maximize', scheduleSave)
  win.on('unmaximize', scheduleSave)
  // The debounced write would be cut short by the window disappearing.
  win.on('close', () => {
    if (timer) clearTimeout(timer)
    save()
  })
}
