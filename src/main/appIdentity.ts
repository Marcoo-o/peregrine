import { app, shell } from 'electron'
import { join } from 'node:path'

/**
 * Who Windows takes this application to be.
 *
 * It decides the name and the icon in the header of a notification, and it has to be the same
 * string as `appId` in electron-builder.yml, because that is what the installer stamps on the
 * Start menu shortcut it creates. A test holds the two together. The notification itself carries
 * no picture of its own: the header says whose it is, and that is enough.
 */
export const APP_ID = 'io.github.marcoo-o.peregrine'

/** Has to run before the first notification, and before the app is ready. */
export function applyAppIdentity(): void {
  if (process.platform === 'win32') app.setAppUserModelId(APP_ID)
}

/**
 * Gives an unpackaged run the identity an installed one gets from its installer.
 *
 * Windows takes the name and icon of a notification's header from a Start menu shortcut that
 * carries the application's identity. The installer makes one. Running from the source, which is
 * how the application is started during development, there is none, and every notification is
 * headed "Electron" with Electron's logo. So a run from the source makes that shortcut itself.
 *
 * It is written only when something about it changed, and that matters. Windows takes a moment to
 * connect a rewritten shortcut to its identity again, and in that moment the header says
 * "Electron". Rewriting it on every start would put that moment into every start.
 *
 * Never for a packaged build: there the installer owns the shortcut, and two of them with one
 * identity would fight over it.
 */
export function registerDevShortcut(): void {
  if (process.platform !== 'win32' || app.isPackaged) return

  const root = app.getAppPath()
  const link = join(
    app.getPath('appData'),
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs',
    'Peregrine.lnk'
  )
  const wanted = {
    target: process.execPath,
    args: `"${root}"`,
    cwd: root,
    icon: join(root, 'resources', 'icon.ico'),
    iconIndex: 0,
    description: 'Peregrine',
    appUserModelId: APP_ID
  }

  try {
    const current = shell.readShortcutLink(link)
    if (
      current.target === wanted.target &&
      current.args === wanted.args &&
      current.icon === wanted.icon &&
      current.appUserModelId === wanted.appUserModelId
    ) {
      return
    }
  } catch {
    // There is no shortcut yet, or it cannot be read. Either way it is written below.
  }

  try {
    shell.writeShortcutLink(link, 'create', wanted)
  } catch (err) {
    // Notifications still work without it. They just carry Electron's name in the header.
    console.error('registering the notification identity failed:', err instanceof Error ? err.message : err)
  }
}
