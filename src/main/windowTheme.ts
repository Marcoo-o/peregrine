import { BrowserWindow, nativeTheme } from 'electron'
import type { ThemeMode } from '@peregrine/core/types'

/**
 * The same values as `--bg` in the stylesheet.
 *
 * Kept in two places because they are needed in two places that cannot reach each other. The
 * stylesheet belongs to the renderer, the window colour to the main process, and the main
 * process reads no CSS. When the two drift apart you see it immediately as a flash on open.
 */
const BACKGROUND = { light: '#f4f5f7', dark: '#1b1e23' } as const

/** Matches `--bg-sunken`, the top bar the window buttons reach into. */
const TITLEBAR = { light: '#eceef1', dark: '#16181c' } as const
/** Matches `--text-muted`, so minimise, maximise and close fit the rest. */
const SYMBOL = { light: '#5c6570', dark: '#9aa3ad' } as const

/** The height of the application's own top bar, so the buttons sit inside it, not above it. */
const TITLEBAR_HEIGHT = 44

/**
 * The window buttons in the application's colours.
 *
 * Otherwise Windows paints the title bar itself and takes the accent colour from the system
 * settings, which is why an active window came up purple no matter how the application was
 * configured. `nativeTheme.themeSource` does not help against that, it only knows light and
 * dark. Only `titleBarStyle: 'hidden'` together with this overlay hands the surface over.
 * Windows then paints the three buttons and nothing else, in the colours given here.
 */
export function titleBarOverlay(): { color: string; symbolColor: string; height: number } {
  const dark = nativeTheme.shouldUseDarkColors
  return {
    color: dark ? TITLEBAR.dark : TITLEBAR.light,
    symbolColor: dark ? SYMBOL.dark : SYMBOL.light,
    height: TITLEBAR_HEIGHT
  }
}

/**
 * The shade a new window is painted in before its content is there.
 *
 * Without `backgroundColor` Electron paints white. On a dark theme every window then flashes
 * light as it opens, and for the main window that lasts as long as the application takes to
 * start.
 */
export function windowBackground(): string {
  return nativeTheme.shouldUseDarkColors ? BACKGROUND.dark : BACKGROUND.light
}

/**
 * Brings the window frames in line with the application's theme.
 *
 * Windows paints the title bar itself, and without this call it follows the system setting. An
 * application set to dark got a light title bar as soon as Windows was set to light.
 * `ThemeMode` and `themeSource` know the same three values, "system" included, so the mapping
 * is literal.
 */
export function applyWindowTheme(theme: ThemeMode): void {
  nativeTheme.themeSource = theme

  // Windows that are already open, too. `backgroundColor` is set when a window is created and
  // otherwise stays on the shade of that moment. It shows when the window is resized, where
  // the newly exposed area stands in that colour until the content is repainted.
  const background = windowBackground()
  const overlay = titleBarOverlay()
  for (const window of BrowserWindow.getAllWindows()) {
    window.setBackgroundColor(background)
    // Only windows with their own title bar have an overlay, and Electron throws for the rest.
    // The composer and the profile chooser keep the native bar.
    try {
      window.setTitleBarOverlay(overlay)
    } catch {
      // No overlay on this window, nothing to do.
    }
  }
}
