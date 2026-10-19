/**
 * Getting a readable sentence out of an error that crossed the IPC boundary.
 *
 * Electron rewraps anything the main process throws: a handler that throws `notConnected`
 * arrives in the renderer as
 *
 *   Error invoking remote method 'messages:move': Error: notConnected
 *
 * and that whole string used to be shown to the user. The channel name is an implementation
 * detail, and the code at the end is meant to be translated, not read.
 *
 * Splitting on `': '` and taking the last piece. Which is what the first version of this did
 * in one place. Falls apart the moment a message contains a colon of its own, and plenty do
 * ("Could not open mailbox INBOX: no such folder"). This works from the front instead: strip
 * the wrappers it knows, keep everything else verbatim.
 */

const REMOTE_PREFIX = /^Error invoking remote method '[^']*':\s*/
const ERROR_PREFIX = /^(?:Uncaught\s+)?Error:\s*/

/** The original message, with the layers IPC added around it taken off. */
export function unwrapIpcMessage(raw: string): string {
  let message = raw.replace(REMOTE_PREFIX, '')
  // Repeated rather than once: an error that passed two boundaries carries two prefixes.
  let previous: string
  do {
    previous = message
    message = message.replace(ERROR_PREFIX, '')
  } while (message !== previous)
  return message.trim()
}

/**
 * A code is a bare identifier, optionally carrying one detail after a colon.
 *
 * `notConnected` and `keyserverRejected:503` are codes; "Could not open mailbox INBOX" is a
 * sentence someone wrote and is shown as it is. The distinction has to be mechanical, because
 * both arrive as the same kind of string. Hence the shape rule: lower camel case, no spaces.
 */
const CODE = /^([a-z][A-Za-z0-9]*)(?::(.*))?$/s

export interface ErrorCode {
  code: string
  /** The part after the colon, when there is one. A folder name, a status, a list. */
  detail: string | null
}

export function parseErrorCode(err: unknown): ErrorCode | null {
  const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : null
  if (raw === null) return null
  const match = CODE.exec(unwrapIpcMessage(raw))
  if (!match) return null
  return { code: match[1], detail: match[2] ?? null }
}

/** What to show when nothing translates it: the message, minus the IPC scaffolding. */
export function plainErrorMessage(err: unknown): string {
  if (err instanceof Error) return unwrapIpcMessage(err.message)
  return unwrapIpcMessage(String(err))
}

/**
 * Every failure the main process reports on purpose.
 *
 * The list is here rather than at each throw site so that both ends agree on it: the main
 * process may only throw a name from this list, and `errors.<name>` has to exist in every
 * locale. Before this, the handlers threw English sentences, which arrived in a German
 * interface as English sentences. Correct, unhelpful, and impossible to translate after the
 * fact because nothing distinguished them from a message out of a library.
 *
 * The four unlock reasons come from `UnlockFailure` in the PGP service, which already threw
 * codes; they are listed here so they are translated the same way everywhere rather than in
 * the one dialog that happened to handle them.
 */
export const ERROR_CODES = [
  'attachmentNotDownloaded',
  'bodyFetchFailed',
  'draftsUnavailable',
  'folderUnavailable',
  'keyserverRejected',
  'mailboxOpenFailed',
  'messageUnavailable',
  'noAccountKey',
  'noPublicKeyFor',
  'noRecipients',
  'notConnected',
  'notPrivate',
  'osEncryptionUnavailable',
  'passphraseRequired',
  'sourceFetchFailed',
  'specialFolderDelete',
  'specialFolderRename',
  'targetFolderUnavailable',
  'trashUnavailable',
  'unreadable',
  'wrongPassphrase'
] as const

export type AppErrorCode = (typeof ERROR_CODES)[number]

/**
 * Builds one of the errors above, optionally carrying a detail for the translated text.
 *
 * The detail is appended after a colon because that survives the trip through IPC unchanged.
 * Anything structured would have to be serialised, and Electron only carries the message.
 */
export function appError(code: AppErrorCode, detail?: string): Error {
  return new Error(detail === undefined ? code : `${code}:${detail}`)
}

export function isAppErrorCode(value: string): value is AppErrorCode {
  return (ERROR_CODES as readonly string[]).includes(value)
}
