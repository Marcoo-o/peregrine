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
import { SearchScreen } from './SearchScreen'
import { SettingsScreen } from './SettingsScreen'
import { UnifiedScreen } from './UnifiedScreen'

/** The screen for what the application is showing, with what each of its buttons does handed to it. */
export function ScreenView(props: { application: Application; screen: Screen }): ReactElement {
  const { navigator, messages, compose, accounts, settings, selection, tags, services } = props.application
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
          onSearch={() => navigator.showSearch('')}
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
          // Another role is another list, which has not been filtered by what the last one was filtered by.
          key={screen.role}
          state={screen}
          actions={selection}
          onRefresh={() => navigator.showUnified({ refresh: true })}
          onSearch={() => navigator.showSearch('')}
          onSettings={() => settings.show()}
          onCompose={() => compose.startNewFromAnyAccount(screen)}
          onCreateTag={(name, color) => tags.create(name, color)}
          onOpen={(message) => messages.openFromUnified(message)}
        />
      )
    case 'search':
      return (
        <SearchScreen
          state={screen}
          onSearch={(query) => navigator.showSearch(query, 'typing')}
          onOpen={(message) => messages.openFromSearch(message, screen.query)}
          onBack={() => navigator.showAccounts()}
        />
      )
    case 'folders':
      return (
        <FoldersScreen
          state={screen}
          onOpen={(folder) => navigator.showMessages(screen.account, folder, { sync: true })}
          onSearch={() => navigator.showSearch('')}
          onSettings={() => settings.show()}
          onRemove={() => accounts.remove(screen.account)}
          onConnect={() => navigator.openAccount(screen.account)}
          onCompose={() => compose.startNew(screen.account, screen)}
        />
      )
    case 'messages':
      return (
        <MessagesScreen
          key={screen.folder.id}
          state={screen}
          actions={selection}
          onRefresh={() => navigator.showMessages(screen.account, screen.folder, { sync: true })}
          onSearch={() => navigator.showSearch('')}
          onSettings={() => settings.show()}
          onCompose={() => compose.startNew(screen.account, screen)}
          onCreateTag={(name, color) => tags.create(name, color)}
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
          onEdit={() => compose.startFromDraft(screen)}
          onSetTag={(keyword, on) => messages.setTag(screen, keyword, on)}
          onCreateTag={(name, color) => tags.create(name, color)}
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
          suggest={(typed) => compose.suggest(typed)}
          onSaveDraft={(draft) => compose.saveDraft(screen, draft)}
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
          onShowPreview={(show) => settings.setShowPreview(show)}
          onQuietHours={(on) => settings.setQuietHours(on)}
          onQuietTime={(end, value) => settings.setQuietTime(end, value)}
          onMuted={(accountId) => settings.toggleMuted(accountId)}
          onInterval={(minutes) => settings.setInterval(minutes)}
          onRunNow={() => settings.runNow()}
        />
      )
  }
}
