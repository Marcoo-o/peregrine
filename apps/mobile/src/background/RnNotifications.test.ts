import { describe, expect, it } from 'vitest'
import { RnNotifications, RnSyncSchedule, type NativeNotifications, type NativeSync } from './RnNotifications'

function nativeNotifications(over: Partial<NativeNotifications> = {}) {
  const calls: unknown[] = []
  const native: NativeNotifications = {
    permitted: async () => true,
    ensurePermission: async () => true,
    show: async (options) => void calls.push(options),
    clearAll: async () => void calls.push('clearAll'),
    consumeLaunchTarget: async () => null,
    ...over
  }
  return { notifications: new RnNotifications(native), calls }
}

const target = { accountId: 'a', folderId: 'f', uid: 7 }

describe('the notifications of the device', () => {
  it('pass what a notification says across the bridge', async () => {
    const { notifications, calls } = nativeNotifications()
    await notifications.show({ accountId: 'a', title: 'Anna', body: 'Budget', subtitle: 'Work', count: 1, target })
    expect(calls).toEqual([{ accountId: 'a', title: 'Anna', body: 'Budget', subtitle: 'Work', count: 1, target }])
  })

  it('leave out a subtitle that is not there, and do not send it as nothing', async () => {
    const { notifications, calls } = nativeNotifications()
    await notifications.show({ accountId: 'a', title: 'Work', body: '3 neue Nachrichten', count: 3, target })
    expect(calls[0]).not.toHaveProperty('subtitle')
  })

  it('ask whether they are permitted, and ask the user for the permission', async () => {
    const { notifications } = nativeNotifications({ permitted: async () => false, ensurePermission: async () => true })
    expect(await notifications.permitted()).toBe(false)
    expect(await notifications.ensurePermission()).toBe(true)
  })

  it('give the message a tap led to, once as the native side does', async () => {
    const answers = [target, null]
    const { notifications } = nativeNotifications({ consumeLaunchTarget: async () => answers.shift() ?? null })
    expect(await notifications.consumeLaunchTarget()).toEqual(target)
    expect(await notifications.consumeLaunchTarget()).toBeNull()
  })

  it('clear what is shown', async () => {
    const { notifications, calls } = nativeNotifications()
    await notifications.clearAll()
    expect(calls).toEqual(['clearAll'])
  })

  it('pass on the failure of the native side with its reason', async () => {
    const { notifications } = nativeNotifications({
      show: async () => {
        throw new Error('Notifications are not permitted')
      }
    })
    await expect(notifications.show({ accountId: 'a', title: 't', body: 'b', count: 1, target })).rejects.toThrow('not permitted')
  })
})

describe('the schedule of the platform', () => {
  it('is told every so many minutes, to stop, and to look now', async () => {
    const calls: string[] = []
    const native: NativeSync = {
      schedule: async (minutes) => void calls.push(`schedule ${minutes}`),
      cancel: async () => void calls.push('cancel'),
      runNow: async () => void calls.push('runNow')
    }
    const schedule = new RnSyncSchedule(native)
    await schedule.schedule(30)
    await schedule.runNow()
    await schedule.cancel()
    expect(calls).toEqual(['schedule 30', 'runNow', 'cancel'])
  })
})
