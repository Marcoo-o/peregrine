import { shouldNotify } from '@peregrine/core/notificationPolicy'
import { senderName } from '../senderName'
import { policyOf, type NotificationSettings } from '../settings'
import type { NewMessage } from './newMail'
import { msg, t, tn } from '../i18n'

/** What opening a notification leads to: the message it is about. */
export interface MessageTarget {
  accountId: string
  folderId: string
  uid: number
  /** Opening it goes straight to an answer to the message, which is what the button "Reply" of a notification leads to. */
  reply?: boolean
}

/** The words on the buttons of a notification, in the language of the application: the platform shows them as they are given. */
export interface NotificationButtons {
  archive: string
  read: string
  reply: string
}

/** One notification for the new mail of one account. */
export interface MailNotification {
  accountId: string
  title: string
  body: string
  /** The account, when the title is the sender. */
  subtitle?: string
  /** How many new messages it stands for. */
  count: number
  /** The newest of them, which is what a tap on the notification opens. */
  target: MessageTarget
  /**
   * The buttons "Archive", "Mark read" and "Reply", which are about one message: only a notification that stands for one message has them. On a locked
   * screen the platform shows the public version of a notification, which has none.
   */
  buttons?: NotificationButtons
}

/** The words of the buttons, in the language the application is in now. */
const buttonWords = (): NotificationButtons => ({ archive: t('Archivieren'), read: t('Gelesen'), reply: t('Antworten') })

/** Something that shows notifications: the platform's, or one that writes down what it was told. */
export interface Notifier {
  show(notification: MailNotification): Promise<void>
}

const NEW_MESSAGE = msg('Neue Nachricht')

/** What is said when the preview is off, or when there is more than one: how many, and nothing else. */
export function countText(count: number): string {
  return tn(count, '{count} neue Nachricht', '{count} neue Nachrichten')
}

/** The same for messages that were put aside and are back, as the desktop says it. */
export function backCountText(count: number): string {
  return tn(count, 'Nachricht ist wieder da', '{count} Nachrichten sind wieder da')
}

/** What the notifications are for: mail that arrived, or messages that were put aside whose moment has come. */
export type NotificationKind = 'new' | 'back'

/** What the notification of a single message says under it: the account, and for a message that is back, that it is. */
const subtitleFor = (kind: NotificationKind, accountName: string): string => (kind === 'back' ? t('Wiedervorlage für {accountName}', { accountName }) : accountName)

/**
 * The notifications for new mail, one for each account that is to be told, as the desktop makes them.
 *
 * A single message with the preview on says who wrote and what about, with the account beneath. More
 * than one, or no preview, says only for which account and how many: what a stranger looking at the
 * screen would learn from anything else is not for them. A tap opens the newest of the messages. Muted
 * accounts, quiet hours and a switch that is off give none, by the rule the desktop uses. Messages that are back
 * from being put aside are told the same way, only as being back and not as being new.
 */
export function buildNotifications(
  newMessages: NewMessage[],
  settings: NotificationSettings,
  now: Date,
  kind: NotificationKind = 'new'
): MailNotification[] {
  const policy = policyOf(settings)
  const byAccount = new Map<string, NewMessage[]>()
  for (const message of newMessages) {
    byAccount.set(message.accountId, [...(byAccount.get(message.accountId) ?? []), message])
  }

  const notifications: MailNotification[] = []
  for (const [accountId, messages] of byAccount) {
    if (!shouldNotify(policy, accountId, now)) continue
    const newest = messages.reduce((a, b) => (b.uid > a.uid ? b : a))
    const target = { accountId, folderId: newest.folderId, uid: newest.uid }
    const accountName = newest.accountName

    if (messages.length === 1 && settings.preview) {
      notifications.push({
        accountId,
        title: senderName(newest.sender) || accountName,
        body: newest.subject || t(NEW_MESSAGE),
        subtitle: subtitleFor(kind, accountName),
        count: 1,
        target,
        buttons: buttonWords()
      })
    } else {
      const body = kind === 'back' ? backCountText(messages.length) : countText(messages.length)
      notifications.push({ accountId, title: accountName, body, count: messages.length, target, ...(messages.length === 1 ? { buttons: buttonWords() } : {}) })
    }
  }
  return notifications
}
