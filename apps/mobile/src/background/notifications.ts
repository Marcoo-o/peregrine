import { shouldNotify } from '@peregrine/core/notificationPolicy'
import { senderName } from '../senderName'
import { policyOf, type NotificationSettings } from '../settings'
import type { NewMessage } from './newMail'

/** What opening a notification leads to: the message it is about. */
export interface MessageTarget {
  accountId: string
  folderId: string
  uid: number
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
}

/** Something that shows notifications: the platform's, or one that writes down what it was told. */
export interface Notifier {
  show(notification: MailNotification): Promise<void>
}

const NEW_MESSAGE = 'Neue Nachricht'

/** What is said when the preview is off, or when there is more than one: how many, and nothing else. */
export function countText(count: number): string {
  return count === 1 ? '1 neue Nachricht' : `${count} neue Nachrichten`
}

/** The same for messages that were put aside and are back, as the desktop says it. */
export function backCountText(count: number): string {
  return count === 1 ? 'Nachricht ist wieder da' : `${count} Nachrichten sind wieder da`
}

/** What the notifications are for: mail that arrived, or messages that were put aside whose moment has come. */
export type NotificationKind = 'new' | 'back'

/** What the notification of a single message says under it: the account, and for a message that is back, that it is. */
const subtitleFor = (kind: NotificationKind, accountName: string): string => (kind === 'back' ? `Wiedervorlage · ${accountName}` : accountName)

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
        body: newest.subject || NEW_MESSAGE,
        subtitle: subtitleFor(kind, accountName),
        count: 1,
        target
      })
    } else {
      const body = kind === 'back' ? backCountText(messages.length) : countText(messages.length)
      notifications.push({ accountId, title: accountName, body, count: messages.length, target })
    }
  }
  return notifications
}
