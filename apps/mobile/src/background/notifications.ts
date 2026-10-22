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

/**
 * The notifications for new mail, one for each account that is to be told, as the desktop makes them.
 *
 * A single message with the preview on says who wrote and what about, with the account beneath. More
 * than one, or no preview, says only for which account and how many: what a stranger looking at the
 * screen would learn from anything else is not for them. A tap opens the newest of the messages. Muted
 * accounts, quiet hours and a switch that is off give none, by the rule the desktop uses.
 */
export function buildNotifications(
  newMessages: NewMessage[],
  settings: NotificationSettings,
  now: Date
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
        subtitle: accountName,
        count: 1,
        target
      })
    } else {
      notifications.push({ accountId, title: accountName, body: countText(messages.length), count: messages.length, target })
    }
  }
  return notifications
}
