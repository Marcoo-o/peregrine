import { describe, expect, it } from 'vitest'
import { DEFAULT_NOTIFICATION_SETTINGS, type NotificationSettings } from '../settings'
import type { NewMessage } from './newMail'
import { buildNotifications, countText } from './notifications'

const settings = (over: Partial<NotificationSettings> = {}): NotificationSettings => ({
  ...DEFAULT_NOTIFICATION_SETTINGS,
  enabled: true,
  ...over
})

const message = (over: Partial<NewMessage> = {}): NewMessage => ({
  accountId: 'work',
  accountName: 'Work',
  folderId: 'f-work',
  uid: 1,
  sender: 'Anna <anna@example.net>',
  subject: 'Budget',
  ...over
})

const noon = new Date(2026, 9, 20, 12, 0)
const night = new Date(2026, 9, 20, 23, 30)

describe('how many', () => {
  it('is said in the singular and the plural', () => {
    expect(countText(1)).toBe('1 neue Nachricht')
    expect(countText(4)).toBe('4 neue Nachrichten')
  })
})

describe('the notifications for new mail', () => {
  it('say who wrote and what about for one message, with the account beneath', () => {
    expect(buildNotifications([message()], settings(), noon)).toEqual([
      {
        accountId: 'work',
        title: 'Anna',
        body: 'Budget',
        subtitle: 'Work',
        count: 1,
        target: { accountId: 'work', folderId: 'f-work', uid: 1 }
      }
    ])
  })

  it('say that there is a new message when it has no subject, and use the address for a sender with no name', () => {
    const [notification] = buildNotifications([message({ subject: '', sender: 'anna@example.net' })], settings(), noon)
    expect(notification).toMatchObject({ title: 'anna@example.net', body: 'Neue Nachricht' })
  })

  it('say only for which account and how many, when there is more than one message', () => {
    const [notification] = buildNotifications([message({ uid: 1 }), message({ uid: 2, subject: 'Other' })], settings(), noon)
    expect(notification).toMatchObject({ title: 'Work', body: '2 neue Nachrichten', count: 2 })
    expect(notification.subtitle).toBeUndefined()
  })

  it('open the newest message of the account', () => {
    const [notification] = buildNotifications([message({ uid: 4 }), message({ uid: 9 }), message({ uid: 7 })], settings(), noon)
    expect(notification.target).toEqual({ accountId: 'work', folderId: 'f-work', uid: 9 })
  })

  it('say nothing about who wrote and what about when the preview is off', () => {
    const [notification] = buildNotifications([message()], settings({ preview: false }), noon)
    expect(notification).toMatchObject({ title: 'Work', body: '1 neue Nachricht' })
    expect(JSON.stringify(notification)).not.toContain('Budget')
    expect(JSON.stringify(notification)).not.toContain('Anna')
    // it still leads to the message
    expect(notification.target.uid).toBe(1)
  })

  it('are one for each account', () => {
    const notifications = buildNotifications(
      [message(), message({ accountId: 'home', accountName: 'Home', folderId: 'f-home', uid: 5, sender: 'Dana <dana@example.net>', subject: 'Dinner' })],
      settings(),
      noon
    )
    expect(notifications.map((n) => [n.accountId, n.title, n.body])).toEqual([
      ['work', 'Anna', 'Budget'],
      ['home', 'Dana', 'Dinner']
    ])
  })

  it('are none for an account that is muted, and the others still come', () => {
    const notifications = buildNotifications(
      [message(), message({ accountId: 'home', accountName: 'Home', folderId: 'f-home' })],
      settings({ mutedAccountIds: ['work'] }),
      noon
    )
    expect(notifications.map((n) => n.accountId)).toEqual(['home'])
  })

  it('are none in the quiet hours, across midnight, and come outside them', () => {
    const quiet = settings({ quietFrom: '22:00', quietTo: '07:00' })
    expect(buildNotifications([message()], quiet, night)).toEqual([])
    expect(buildNotifications([message()], quiet, new Date(2026, 9, 20, 6, 59))).toEqual([])
    expect(buildNotifications([message()], quiet, new Date(2026, 9, 20, 7, 0))).toHaveLength(1)
  })

  it('are none when the switch is off, and none for no new mail', () => {
    expect(buildNotifications([message()], settings({ enabled: false }), noon)).toEqual([])
    expect(buildNotifications([], settings(), noon)).toEqual([])
  })
})
