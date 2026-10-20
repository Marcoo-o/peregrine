import type { Account } from '../accounts'
import type { AttachmentInfo } from '../attachments'
import type { Draft } from '../draft'
import type { Folder } from '../folders'
import type { StoredMessage } from '../messages'
import type { ReadableMessage } from '../messageText'
import type { RefreshResult, UnifiedMessage } from '../unified'

/**
 * What the application can be showing. One of these is the whole of what a screen needs, so that a
 * screen is a function of it and has no state of its own that matters to anybody else.
 */

/** Where a message was opened from, and so where leaving it goes back to. */
export type MessageOrigin = 'folder' | 'unified'

export interface LoadingState {
  name: 'loading'
}

export interface AccountsState {
  name: 'accounts'
  accounts: Account[]
  error?: string
}

export interface LoginState {
  name: 'login'
  error?: string
}

export interface UnifiedState {
  name: 'unified'
  messages: UnifiedMessage[]
  busy: boolean
  /** The accounts that could not be brought up to date, each with its reason. */
  problems: RefreshResult[]
}

export interface FoldersState {
  name: 'folders'
  account: Account
  folders: Folder[]
  /** Why the account could not be reached, when what is shown is only what was fetched before. */
  offline?: string
}

export interface MessagesState {
  name: 'messages'
  account: Account
  folder: Folder
  messages: StoredMessage[]
  /** The names of the account's folders by id, for saying where a message is on its way to. */
  folderNames: Record<string, string>
  busy: boolean
  error?: string
}

/** What identifies the message that is open, whichever screen it is open on. */
interface OpenMessage {
  account: Account
  folder: Folder
  summary: StoredMessage
  origin: MessageOrigin
}

export interface MessageState extends OpenMessage {
  name: 'message'
  message?: ReadableMessage
  /** The source of the message and the attachments found in it, for saving and opening them. */
  source?: Uint8Array
  attachments?: AttachmentInfo[]
  /** What was said about the last thing done with an attachment. */
  notice?: string
  error?: string
}

export interface MoveState extends OpenMessage {
  name: 'move'
  /** The folders the message can be moved to. */
  targets: Folder[]
  /** The message screen this one was opened from, which going back shows again as it was. */
  returnTo: MessageState
}

export interface ComposeState {
  name: 'compose'
  account: Account
  /** The screen that is shown again when the message has gone into the queue or is given up. */
  returnTo: Screen
  draft: Draft
  busy: boolean
  error?: string
}

export type Screen =
  | LoadingState
  | AccountsState
  | LoginState
  | UnifiedState
  | FoldersState
  | MessagesState
  | MessageState
  | MoveState
  | ComposeState

/** The screens that are about the mail of the accounts and so show what waits in the queue. */
export function showsQueueStatus(screen: Screen): boolean {
  return (
    screen.name === 'unified' ||
    screen.name === 'folders' ||
    screen.name === 'messages' ||
    screen.name === 'message' ||
    screen.name === 'move'
  )
}
