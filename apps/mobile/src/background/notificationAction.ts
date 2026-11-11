import { getAccount } from '../accounts'
import { describeError } from '../errors'
import type { Log, Services } from '../app/services'
import { SEEN } from '../flags'
import { getFolder, getFolderBySpecialUse } from '../folders'
import { getMessage } from '../messages'
import type { MessageTarget } from './notifications'

/** What a button of a notification does to the message it is about, without the application being opened. */
export type NotificationActionName = 'archive' | 'read'

export const NOTIFICATION_ACTIONS: readonly NotificationActionName[] = ['archive', 'read']

/** What came of it: done and told to the server, done and waiting for a connection, or not possible and why. */
export type NotificationActionResult = 'done' | 'queued' | 'message gone' | 'no archive folder'

export interface NotificationActionDeps {
  services: Pick<Services, 'db' | 'connections' | 'mail'>
  log: Log
  /** How long it waits for a connection, after which the action stays in the queue and is sent at the next chance. */
  connectTimeoutMs?: number
}

/**
 * Archives a message or marks it read, for a button of a notification.
 *
 * The change is made to the local copy at once and goes through the queue like every other decision, so it is not lost when
 * there is no connection: it waits and is sent with the next look for mail, or when the application is opened. With a
 * connection the queue is run straight away, so that the server has it before the task ends.
 */
export async function runNotificationAction(
  deps: NotificationActionDeps,
  action: NotificationActionName,
  target: MessageTarget
): Promise<NotificationActionResult> {
  const { services, log } = deps
  const { db, mail, connections } = services
  const folder = await getFolder(db, target.folderId)
  const account = await getAccount(db, target.accountId)
  if (!folder || !account || !(await getMessage(db, folder.id, target.uid))) return 'message gone'

  if (action === 'read') {
    await mail.setFlags(folder, [target.uid], [SEEN], [])
  } else {
    const archive = await getFolderBySpecialUse(db, account.id, '\\Archive')
    if (!archive) return 'no archive folder'
    await mail.move(folder, [target.uid], archive)
  }

  try {
    await withTimeout(connections.ensure(account), deps.connectTimeoutMs ?? 20_000)
    await mail.flush(account.id)
    return 'done'
  } catch (error) {
    log.warn(`the ${action} of a notification waits for a connection: ${describeError(error)}`)
    return 'queued'
  } finally {
    connections.dropAll()
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no connection in time')), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}
