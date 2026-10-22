import { describe, expect, it, vi } from 'vitest'
import { backAction } from './backAction'
import type { Screen } from './screens'

const application = () => ({
  navigator: { showAccounts: vi.fn(async () => undefined), leaveLogin: vi.fn(async () => true) },
  messages: { leave: vi.fn(async () => undefined), cancelMove: vi.fn(async () => undefined) },
  settings: { back: vi.fn(async () => undefined), show: vi.fn(async () => undefined) }
})

// The controllers are what the screens' own ways back call, so a stand-in with those calls is all that is looked at.
const asApplication = (stub: ReturnType<typeof application>) => stub as never

const named = (name: Screen['name']) => ({ name }) as Screen

describe('what the back key does', () => {
  it('leaves the application from the screens that have no way back', () => {
    const app = application()
    for (const name of ['loading', 'accounts', 'unified', 'messages', 'compose'] as const) {
      expect(backAction(asApplication(app), named(name), () => undefined)).toBeNull()
    }
  })

  it('does what the way back of the screen does', () => {
    const app = application()
    const message = named('message')
    backAction(asApplication(app), message, () => undefined)?.()
    expect(app.messages.leave).toHaveBeenCalledWith(message)

    const move = named('move')
    backAction(asApplication(app), move, () => undefined)?.()
    expect(app.messages.cancelMove).toHaveBeenCalledWith(move)

    backAction(asApplication(app), named('settings'), () => undefined)?.()
    expect(app.settings.back).toHaveBeenCalledOnce()

    backAction(asApplication(app), named('tags'), () => undefined)?.()
    expect(app.settings.show).toHaveBeenCalledOnce()

    backAction(asApplication(app), named('search'), () => undefined)?.()
    backAction(asApplication(app), named('folders'), () => undefined)?.()
    expect(app.navigator.showAccounts).toHaveBeenCalledTimes(2)
  })

  it('leaves the form for an account, and leaves the application when there is no account to go back to', async () => {
    const app = application()
    const leave = vi.fn()
    backAction(asApplication(app), named('login'), leave)?.()
    await Promise.resolve()
    await Promise.resolve()
    expect(leave).not.toHaveBeenCalled()

    app.navigator.leaveLogin.mockResolvedValueOnce(false)
    backAction(asApplication(app), named('login'), leave)?.()
    await Promise.resolve()
    await Promise.resolve()
    expect(leave).toHaveBeenCalledOnce()
  })
})
