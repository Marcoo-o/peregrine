import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({
  app: {
    isPackaged: false,
    getAppPath: () => 'D:\\project',
    getPath: () => 'C:\\Users\\me\\AppData\\Roaming',
    setAppUserModelId: vi.fn()
  },
  shell: {
    readShortcutLink: vi.fn(),
    writeShortcutLink: vi.fn()
  }
}))

vi.mock('electron', () => electron)

import { APP_ID, applyAppIdentity, registerDevShortcut } from './appIdentity'

const setPlatform = (platform: string): void => {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
}
const realPlatform = process.platform

beforeEach(() => {
  setPlatform('win32')
  electron.app.isPackaged = false
  vi.clearAllMocks()
})

describe('the application identity', () => {
  // The installer stamps this on the Start menu shortcut it creates, and a notification takes its
  // name and icon from the shortcut with the matching identity. If the two drift apart, packaged
  // builds go back to being headed with Electron's name.
  it('is the appId the installer is built with', () => {
    const config = readFileSync(join(__dirname, '..', '..', 'electron-builder.yml'), 'utf8')
    expect(/^appId:\s*(\S+)/m.exec(config)?.[1]).toBe(APP_ID)
  })

  it('is set on Windows and nowhere else', () => {
    applyAppIdentity()
    expect(electron.app.setAppUserModelId).toHaveBeenCalledWith(APP_ID)

    electron.app.setAppUserModelId.mockClear()
    setPlatform('linux')
    applyAppIdentity()
    expect(electron.app.setAppUserModelId).not.toHaveBeenCalled()
    setPlatform(realPlatform)
  })
})

describe('registerDevShortcut', () => {
  const wanted = {
    target: process.execPath,
    args: '"D:\\project"',
    // built with the same join as the code, so it is the same string on whichever platform this runs
    icon: join('D:\\project', 'resources', 'icon.ico'),
    appUserModelId: APP_ID
  }

  it('makes the shortcut a notification takes its header from, when there is none', () => {
    electron.shell.readShortcutLink.mockImplementation(() => {
      throw new Error('no such file')
    })

    registerDevShortcut()

    expect(electron.shell.writeShortcutLink).toHaveBeenCalledTimes(1)
    const [link, operation, options] = electron.shell.writeShortcutLink.mock.calls[0]
    expect(link).toMatch(/Start Menu.Programs.Peregrine\.lnk$/)
    expect(operation).toBe('create')
    expect(options).toMatchObject({ ...wanted, description: 'Peregrine' })
  })

  // Windows takes a moment to connect a rewritten shortcut to its identity again, and in that
  // moment the header of a notification says Electron.
  it('leaves a shortcut alone that is already right', () => {
    electron.shell.readShortcutLink.mockReturnValue(wanted)

    registerDevShortcut()

    expect(electron.shell.writeShortcutLink).not.toHaveBeenCalled()
  })

  it('writes it again when it points somewhere else, for instance after the project moved', () => {
    electron.shell.readShortcutLink.mockReturnValue({ ...wanted, args: '"C:\\old\\place"' })

    registerDevShortcut()

    expect(electron.shell.writeShortcutLink).toHaveBeenCalledTimes(1)
  })

  it('writes it again when the identity is missing from it', () => {
    electron.shell.readShortcutLink.mockReturnValue({ ...wanted, appUserModelId: '' })

    registerDevShortcut()

    expect(electron.shell.writeShortcutLink).toHaveBeenCalledTimes(1)
  })

  // There the installer owns the shortcut, and two with one identity would fight over it.
  it('does nothing for a packaged build', () => {
    electron.app.isPackaged = true

    registerDevShortcut()

    expect(electron.shell.readShortcutLink).not.toHaveBeenCalled()
    expect(electron.shell.writeShortcutLink).not.toHaveBeenCalled()
  })

  it('does nothing outside Windows', () => {
    setPlatform('linux')

    registerDevShortcut()

    expect(electron.shell.writeShortcutLink).not.toHaveBeenCalled()
    setPlatform(realPlatform)
  })

  it('does not take the application down when the shortcut cannot be written', () => {
    electron.shell.readShortcutLink.mockImplementation(() => {
      throw new Error('no such file')
    })
    electron.shell.writeShortcutLink.mockImplementation(() => {
      throw new Error('access denied')
    })
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    expect(() => registerDevShortcut()).not.toThrow()
    expect(errors).toHaveBeenCalled()
    errors.mockRestore()
  })
})
