import type { ReactElement } from 'react'
import type { Application } from '../app/Application'
import type { Screen } from '../app/screens'
import { AccountsScreen } from './AccountsScreen'
import { ComposeScreen } from './ComposeScreen'
import { FoldersScreen } from './FoldersScreen'
import { LoadingScreen } from './LoadingScreen'
import { LoginScreen } from './LoginScreen'
import { MessageScreen } from './MessageScreen'
import { MessagesScreen } from './MessagesScreen'
import { MoveScreen } from './MoveScreen'
import { SettingsScreen } from './SettingsScreen'
import { UnifiedScreen } from './UnifiedScreen'

/** The screen for what the application is showing, with what each of its buttons does handed to it. */
export function ScreenView(props: { application: Application; screen: Screen }): ReactElement {
  const { navigator, messages, compose, accounts, settings, services } = props.application
  const { screen } = props

  switch (screen.name) {
    case 'loading':
      return <LoadingScreen />
    case 'accounts':
      return (
        <AccountsScreen
          state={screen}
          onOpen={(account) => navigator.openAccount(account)}
          onAdd={() => navigator.showLogin()}
          onUnified={() => navigator.showUnified({ refresh: true })}
          onSettings={() => settings.show()}
        />
      )
    case 'login':
      return (
        <LoginScreen
          error={screen.error}
          previous={accounts.lastAttempt}
          onSubmit={(form) => accounts.signIn(form)}
          onCancel={() => navigator.leaveLogin()}
        />
      )
    case 'unified':
      return (
        <UnifiedScreen
          state={screen}
          onAccounts={() => navigator.showAccounts()}
          onRefresh={() => navigator.showUnified({ refresh: true })}
          onOpen={(message) => messages.openFromUnified(message)}
        />
      )
    case 'folders':
      return (
        <FoldersScreen
          state={screen}
          onOpen={(folder) => navigator.showMessages(screen.account, folder, { sync: true })}
          onBack={() => navigator.showAccounts()}
          onRemove={() => accounts.remove(screen.account)}
          onConnect={() => navigator.openAccount(screen.account)}
          onCompose={() => compose.startNew(screen.account, screen)}
        />
      )
    case 'messages':
      return (
        <MessagesScreen
          state={screen}
          onBack={() => navigator.showStoredFolders(screen.account)}
          onOpen={(message) => messages.open(screen.account, screen.folder, message, 'folder')}
        />
      )
    case 'message':
      return (
        <MessageScreen
          // Another message is another screen: what was shown or decided on the one before is not carried over.
          key={`${screen.folder.id}:${screen.summary.uid}`}
          state={screen}
          onBack={() => messages.leave(screen)}
          onReply={() => compose.startReply(screen)}
          onReplyAll={() => compose.startReplyAll(screen)}
          onForward={() => compose.startForward(screen)}
          onToggleSeen={() => messages.markUnread(screen)}
          onToggleFlag={() => messages.toggleFlagged(screen)}
          onMove={() => messages.startMove(screen)}
          onArchive={() => messages.archive(screen)}
          onJunk={() => messages.markAsJunk(screen)}
          onDelete={() => messages.delete(screen)}
          onSave={(attachment) => messages.saveAttachment(screen, attachment)}
          onOpenAttachment={(attachment) => messages.openAttachment(screen, attachment)}
        />
      )
    case 'move':
      return (
        <MoveScreen
          state={screen}
          onChoose={(target) => messages.move(screen, target)}
          onBack={() => messages.cancelMove(screen)}
        />
      )
    case 'compose':
      return (
        <ComposeScreen
          state={screen}
          files={services.files}
          onSend={(draft) => compose.send(screen, draft)}
          onCancel={(draft) => compose.cancel(screen, draft)}
        />
      )
    case 'settings':
      return (
        <SettingsScreen
          state={screen}
          onBack={() => settings.back()}
          onEnabled={(enabled) => settings.setEnabled(enabled)}
          onPreview={(preview) => settings.setPreview(preview)}
          onQuietHours={(on) => settings.setQuietHours(on)}
          onQuietTime={(end, value) => settings.setQuietTime(end, value)}
          onMuted={(accountId) => settings.toggleMuted(accountId)}
          onInterval={(minutes) => settings.setInterval(minutes)}
          onRunNow={() => settings.runNow()}
        />
      )
  }
}
