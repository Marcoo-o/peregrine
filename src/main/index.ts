import { app, ipcMain, shell, BrowserWindow } from 'electron'
import { IpcChannels } from '@shared/ipcContracts'
import { pruneAttachmentCache } from './attachments/cache'
import { initialWindowBounds, trackWindowState } from './windowState'
import { applyWindowTheme, titleBarOverlay, windowBackground } from './windowTheme'
import { join } from 'path'
import type { BetterSqliteDb } from './db/sqlDb'
import { applyAppIdentity, registerDevShortcut } from './appIdentity'
import { closeDb, openDb } from './db/db'
import { getAppSettings } from './db/repositories/appSettingsRepo'
import { attachEditingMenu, configureSpellChecker, menuTexts } from './spellcheck'
import { ensureProfileExists, unlockProfile } from './profiles/unlockWindow'
import { registerProfileSettingsIpc } from './ipc/profileSettings'
import { AccountManager } from './accounts/AccountManager'
import { registerAccountsIpc } from './ipc/accounts'
import { registerFoldersIpc } from './ipc/folders'
import { registerMessagesIpc } from './ipc/messages'
import { registerComposeIpc } from './ipc/compose'
import { registerAttachmentsIpc } from './ipc/attachments'
import { registerMailContentIpc } from './ipc/mailContent'
import { registerPrintIpc } from './ipc/print'
import { registerSearchIpc } from './ipc/search'
import { registerFilterRulesIpc } from './ipc/filterRules'
import { registerContactsIpc } from './ipc/contacts'
import { registerTasksIpc } from './ipc/tasks'
import { registerTagsIpc } from './ipc/tags'
import { registerMessageSourceIpc } from './ipc/messageSource'
import { registerDiagnosticsIpc } from './ipc/diagnostics'
import { registerPgpIpc } from './ipc/pgp'
import { registerSettingsIpc } from './ipc/settings'
import { registerIdentitiesIpc } from './ipc/identities'
import {
  registerMailContentProtocolHandler,
  registerMailContentSchemePrivileges
} from './protocols/mailContentProtocol'

registerMailContentSchemePrivileges()
applyAppIdentity()

let mainWindow: BrowserWindow | undefined

function createWindow(): BrowserWindow {
  const bounds = initialWindowBounds()
  const win = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    minWidth: bounds.minWidth,
    minHeight: bounds.minHeight,
    show: false,
    autoHideMenuBar: true,
    // In the packaged application Windows takes the icon from the .exe that electron-builder
    // stamps. During development there is no such .exe, and without this line the window wears
    // the default Electron mark, and so does every screenshot.
    icon: join(__dirname, '../../resources/icon.png'),
    backgroundColor: windowBackground(),
    // Our own title bar. Otherwise Windows paints the whole bar itself and takes the system
    // accent colour for it, which has nothing to do with the application theme. This way it
    // paints only the three buttons, in colours that belong here.
    titleBarStyle: 'hidden',
    titleBarOverlay: titleBarOverlay(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  if (bounds.maximized) win.maximize()
  trackWindowState(win)

  // Links are not opened here. A link inside a message can be built to read as one address
  // and resolve as another, so it goes back to the renderer first. That is where it can be
  // examined and, if it looks like a forgery, put in front of the user before anything opens.
  win.webContents.setWindowOpenHandler(({ url }) => {
    win.webContents.send(IpcChannels.linkActivated, { url })
    return { action: 'deny' }
  })

  // The window shows the application and nothing else. Its own policy already limits it to
  // itself, but that policy is a tag in a document, and this is the process that owns the
  // window. If anything ever manages to navigate the shell away from the app, the renderer
  // stops being the sandboxed page it was built as and becomes a remote page holding a preload
  // bridge. Frames are not covered here: a message frame is held to peregrine-mail:// by the
  // application's own frame-src, and that is where it belongs.
  win.webContents.on('will-navigate', (event, url) => {
    const expected = process.env['ELECTRON_RENDERER_URL']
    const permitted = expected ? url.startsWith(expected) : url.startsWith('file://')
    if (permitted) return
    event.preventDefault()
    console.error('refused to navigate the window to:', url)
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    // The four loose arguments this used to take are deprecated since Electron 35. They are
    // still passed, so the old form kept working, but the event now carries the same fields
    // itself and that is the one that will survive.
    win.webContents.on('console-message', (details) => {
      console.log(`[renderer] ${details.message} (${details.sourceId}:${details.lineNumber})`)
    })
  }

  win.on('ready-to-show', () => {
    win.show()
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

app.whenReady().then(async () => {
  registerMailContentProtocolHandler()
  registerDevShortcut()

  // The gate: no database, no mail IPC and no connections until a profile is unlocked. The
  // server credentials live inside the encrypted database, so before this there is literally
  // nothing to connect with.
  ensureProfileExists()
  let db: BetterSqliteDb
  let profileId: string
  const currentKey = { value: null as string | null }
  try {
    const opened = await unlockProfile()
    db = opened.db
    profileId = opened.profile.id
    currentKey.value = opened.key
  } catch {
    // Chooser closed without unlocking. There is no application to show.
    app.quit()
    return
  }

  // Dictionaries are per session, so this is set once for every window that follows.
  configureSpellChecker()

  // Before the first window, because `windowBackground()` reads from this which shade to
  // paint before there is any content. Setting it afterwards would come too late.
  applyWindowTheme((await getAppSettings(db)).theme)

  mainWindow = createWindow()
  // Read at click time rather than captured: the language can change while the app runs.
  const editingTexts = async (): Promise<ReturnType<typeof menuTexts>> =>
    menuTexts((await getAppSettings(db)).language, app.getLocale())
  attachEditingMenu(mainWindow, editingTexts)

  const accountManager = new AccountManager(db, () => mainWindow?.webContents)

  registerAccountsIpc(ipcMain, db, accountManager)
  registerFoldersIpc(ipcMain, db, accountManager)
  registerMessagesIpc(ipcMain, db, accountManager)
  registerComposeIpc(ipcMain, db, accountManager)
  registerAttachmentsIpc(ipcMain, db, () => mainWindow)
  registerMailContentIpc(ipcMain)
  registerPrintIpc(ipcMain, () => mainWindow)
  registerSearchIpc(ipcMain, db)
  registerFilterRulesIpc(ipcMain, db, accountManager)
  registerContactsIpc(ipcMain, db, () => mainWindow)
  registerTasksIpc(ipcMain, db)
  registerTagsIpc(ipcMain, db, accountManager)
  registerMessageSourceIpc(ipcMain, db, accountManager, () => mainWindow)
  registerPgpIpc(ipcMain, db, () => mainWindow)
  registerSettingsIpc(ipcMain, db)
  registerIdentitiesIpc(ipcMain, db)
  registerProfileSettingsIpc(ipcMain, db, profileId, currentKey)
  registerDiagnosticsIpc(ipcMain, () => mainWindow)

  // Reached only once the renderer has vetted the link (and asked, where that was warranted).
  // Three schemes get through: http, https and mailto, the last because writing to an address
  // in a message is the ordinary thing to want. Everything else is refused, so a message can
  // never hand the shell a file:// path or one of the protocols any installed program is free
  // to register for itself.
  ipcMain.handle(IpcChannels.linksOpenExternal, async (_event, { url }: { url: string }) => {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:' && parsed.protocol !== 'mailto:') {
      return
    }
    await shell.openExternal(url)
  })

  // Housekeeping runs alongside the account startup rather than delaying the first window.
  void pruneAttachmentCache().catch((err) => {
    console.error('attachment cache prune failed:', err instanceof Error ? err.message : err)
  })

  await accountManager.startAllAccounts()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
  })

  app.on('before-quit', () => {
    void accountManager.stopAll()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
