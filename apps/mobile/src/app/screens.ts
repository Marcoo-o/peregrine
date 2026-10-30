import type { PgpStatus } from '@peregrine/core/types'
import type { Account } from '../accounts'
import type { AttachmentInfo } from '../attachments'
import type { PushState } from '../background/devices'
import type { Draft } from '../draft'
import type { ListSettings, NotificationSettings } from '../settings'
import type { Folder } from '../folders'
import type { ContactKey, OwnKey } from '../pgp/keyStore'
import type { KeyState, ScannedKey } from '../pgp/pgpService'
import type { MessageAssessment } from '../reading/assessment'
import type { StoredMessage } from '../messages'
import type { ReadableMessage } from '../messageText'
import type { SearchHit, SearchResult } from '../search'
import type { RefreshResult, UnifiedMessage, UnifiedRole } from '../unified'

/**
 * What the application can be showing. One of these is the whole of what a screen needs, so that a
 * screen is a function of it and has no state of its own that matters to anybody else.
 */

/** Where a message was opened from, and so where leaving it goes back to. */
export type MessageOrigin = 'folder' | 'unified' | 'search'

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
  /** Which folders of the accounts the list holds: the inboxes, the sent folders, and so on. */
  role: UnifiedRole
  messages: UnifiedMessage[]
  /** Whether the lines of text under the subjects are shown. */
  showPreview: boolean
  busy: boolean
  /** The accounts that could not be brought up to date, each with its reason. */
  problems: RefreshResult[]
  /** There are older messages than the list shows, on the phone or on the servers. */
  more: boolean
  /** Older messages are being loaded. */
  loadingMore?: boolean
}

export interface SearchState {
  name: 'search'
  /** What was typed. */
  query: string
  messages: SearchHit[]
  showPreview: boolean
  /** The parts of the search that the phone cannot do, which it was made without. */
  unsupported: SearchResult['unsupported']
}

export interface FoldersState {
  name: 'folders'
  account: Account
  folders: Folder[]
  /** How many messages of each folder are not read, by the id of the folder. A folder with none is left out. */
  unread: Record<string, number>
  /** Why the account could not be reached, when what is shown is only what was fetched before. */
  offline?: string
}

export interface MessagesState {
  name: 'messages'
  account: Account
  folder: Folder
  messages: StoredMessage[]
  showPreview: boolean
  /** The names of the account's folders by id, for saying where a message is on its way to. */
  folderNames: Record<string, string>
  busy: boolean
  /** The server has older messages in this folder than the phone has loaded. */
  hasOlder: boolean
  /** Older messages are being loaded. */
  loadingOlder?: boolean
  error?: string
}

/** What identifies the message that is open, whichever screen it is open on. */
interface OpenMessage {
  account: Account
  folder: Folder
  summary: StoredMessage
  origin: MessageOrigin
  /** The search the message was found by, which leaving it goes back to. */
  searchQuery?: string
}

export interface MessageState extends OpenMessage {
  name: 'message'
  message?: ReadableMessage
  /** The source of the message and the attachments found in it, for saving and opening them. */
  source?: Uint8Array
  attachments?: AttachmentInfo[]
  /** What is known of the message from its headers: what the server made of it and who it says it is from. */
  assessment?: MessageAssessment
  /** The domains of the user's addresses, which a sender or a link is measured against for looking like one. */
  knownDomains?: string[]
  /** What the message says of its signature and its encryption; the message above is then the content that was opened. */
  protection?: PgpStatus
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

export interface SettingsState {
  name: 'settings'
  settings: NotificationSettings
  /** What is set about the lists of messages. */
  list: ListSettings
  /** Whether the system lets the application read the address book, whatever is switched on here. */
  contactsPermitted: boolean
  accounts: Account[]
  /** Whether the system lets the application show notifications at all, whatever is switched on here. */
  permitted: boolean
  /** How the phone is told of new mail at once: by the system's push service, or by connections of its own that are switched on. */
  push: PushState
  /** What was said about the last thing done, or nothing. */
  notice?: string
}

/** What the automatic keeping of a draft has done last, which the compose screen says in a line. */
export type AutosaveStatus =
  | { status: 'saving' }
  | { status: 'waiting' }
  | { status: 'saved'; at: number }
  | { status: 'failed'; error: string }

export interface ComposeState {
  name: 'compose'
  /** Which writing of a message this is, so that what finishes later is put on it and not on another that began since. */
  session: string
  account: Account
  /** The screen that is shown again when the message has gone into the queue or is given up. */
  returnTo: Screen
  draft: Draft
  /** The drafts folder this message was opened from, when it was opened from a draft: leaving it shows that folder again. */
  fromDraft?: Folder
  /** Where the server keeps the last revision of this message that was kept: sending or keeping it again replaces it. */
  saved?: { folder: Folder; uid: number }
  /** The message as it was last kept, which is what has been changed since when the user has written on. */
  savedDraft?: Draft
  autosave?: AutosaveStatus
  /** The server did not say where it put the draft, so a later revision cannot replace it: nothing more is kept by itself. */
  noAutosave?: boolean
  busy: boolean
  error?: string
}

/** The OpenPGP keys: those of the accounts, the public keys of the people the user writes to, and keys that were read and wait to be placed. */
export interface KeysState {
  name: 'keys'
  accounts: Account[]
  /** The keys of each account, by the id of the account, the newest first. */
  own: Record<string, OwnKey[]>
  contacts: ContactKey[]
  /** What the user wants of every message: signed, encrypted. */
  defaults: { sign: boolean; encrypt: boolean }
  /** What each key is good for now, by fingerprint: expired, withdrawn. */
  states: Record<string, KeyState>
  /** What was read from a file or from pasted text, not stored yet: the user says where each key belongs. */
  found?: ScannedKey[]
  /** What is being done that takes long, said on the screen. */
  working?: string
  notice?: string
  error?: string
}

/** What can be done to a folder, or, with none, a new folder to make. */
export interface FolderToolsState {
  name: 'folderTools'
  account: Account
  /** The folder the screen is about, or null for the making of a new one. */
  folder: Folder | null
  /** The folders of the account, for choosing where a new one sits and for checking a name against the ones next to it. */
  folders: Folder[]
  busy?: boolean
  error?: string
  /** What was done last, in a line, when it left the screen where it is. */
  notice?: string
}

/** Changing an account: its name and colour, its servers and its logins. */
export interface EditAccountState {
  name: 'editAccount'
  account: Account
  /** What is being tried against the servers before it is kept. */
  busy?: boolean
  error?: string
}

/** The tags of the user, which are shown from the store, and how many messages have each, by keyword in lower case. */
export interface TagsState {
  name: 'tags'
  counts: Record<string, number>
}

export type Screen =
  | LoadingState
  | AccountsState
  | LoginState
  | UnifiedState
  | SearchState
  | FoldersState
  | MessagesState
  | MessageState
  | MoveState
  | ComposeState
  | SettingsState
  | KeysState
  | EditAccountState
  | FolderToolsState
  | TagsState

/** The screens that are about the mail of the accounts and so show what waits in the queue. */
export function showsQueueStatus(screen: Screen): boolean {
  return (
    screen.name === 'unified' ||
    screen.name === 'search' ||
    screen.name === 'folders' ||
    screen.name === 'messages' ||
    screen.name === 'message' ||
    screen.name === 'move'
  )
}
