import type { Application } from './Application'
import type { Screen } from './screens'

/**
 * What the back key of the phone does on a screen: the same as the way back that the screen shows, or nothing
 * when the screen has none. A screen with none is where the application starts and the one the user leaves it from,
 * so the key then leaves it, as it does for every application.
 *
 * The form for an account has a way back only when there is an account to go back to; the first form the user sees has
 * none, and the key leaves the application from it, which is what `leave` is for.
 *
 * The writing of a message is not here: its way back has to carry the draft, which only that screen has.
 */
export function backAction(
  application: Pick<Application, 'navigator' | 'messages' | 'settings' | 'folders' | 'senders' | 'compose'>,
  screen: Screen,
  leave: () => void
): (() => void) | null {
  const { navigator, messages, settings, folders, senders } = application
  switch (screen.name) {
    case 'message':
      return () => void messages.leave(screen)
    case 'move':
      return () => void messages.cancelMove(screen)
    case 'settings':
      return () => void settings.back()
    case 'filterRules':
    case 'contacts':
      return () => void settings.show()
    case 'thread':
      return () => messages.closeThread(screen)
    case 'source':
      return () => messages.closeSource(screen)
    case 'scheduled':
      return () => void application.compose.leaveScheduled(screen)
    case 'identities':
      return () => void senders.back(screen.account)
    case 'folderTools':
      return () => void folders.back(screen)
    case 'editAccount':
      return () => void navigator.showStoredFolders(screen.account)
    case 'tags':
    case 'keys':
      return () => void settings.show()
    case 'search':
    case 'folders':
      return () => void navigator.showAccounts()
    case 'login':
      return () => void navigator.leaveLogin().then((left) => (left ? undefined : leave()))
    case 'loading':
    case 'accounts':
    case 'unified':
    case 'messages':
    case 'compose':
      return null
  }
}
