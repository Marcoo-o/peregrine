import type { ReactElement } from 'react'
import type { Application } from '../app/Application'
import type { Screen } from '../app/screens'
import { AccountsScreen } from './AccountsScreen'
import { ComposeScreen } from './ComposeScreen'
import { EditAccountScreen } from './EditAccountScreen'
import { FolderToolsScreen } from './FolderToolsScreen'
import { FoldersScreen } from './FoldersScreen'
import { IdentitiesScreen } from './IdentitiesScreen'
import { ScheduledScreen } from './ScheduledScreen'
import { SourceScreen } from './SourceScreen'
import { ThreadScreen } from './ThreadScreen'
import { ContactsScreen } from './ContactsScreen'
import { FilterRulesScreen } from './FilterRulesScreen'
import { TasksScreen } from './TasksScreen'
import { LoadingScreen } from './LoadingScreen'
import { LoginScreen } from './LoginScreen'
import { MessageScreen } from './MessageScreen'
import { MessagesScreen } from './MessagesScreen'
import { MoveScreen } from './MoveScreen'
import { SearchScreen } from './SearchScreen'
import { SettingsScreen } from './SettingsScreen'
import { KeysScreen } from './KeysScreen'
import { TagsScreen } from './TagsScreen'
import { UnifiedScreen } from './UnifiedScreen'

/** The screen for what the application is showing, with what each of its buttons does handed to it. */
export function ScreenView(props: { application: Application; screen: Screen }): ReactElement {
  const { navigator, messages, compose, accounts, settings, selection, tags, keys, folders, senders, contacts, filters, tasks, services } = props.application
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
          onFind={(email) => accounts.find(email)}
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
          onThread={(thread) =>
            messages.showThread({
              subject: thread[0].subject,
              origin: 'unified',
              returnTo: screen,
              items: thread.map((message) => ({ message, accountId: message.accountId, folderId: message.folderId, accountName: message.accountName, accountColor: message.accountColor }))
            })
          }
          onOlder={() => navigator.showMoreUnified()}
        />
      )
    case 'search':
      return (
        <SearchScreen
          state={screen}
          onSearch={(query) => navigator.showSearch(query, 'typing')}
          onOpen={(message) => messages.openFromSearch(message, screen.query)}
          onBack={() => navigator.showAccounts()}
          onSave={() => navigator.saveCurrentSearch()}
          onRemove={() => navigator.removeCurrentSearch()}
          onRename={(name) => navigator.renameCurrentSearch(name)}
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
          onEdit={() => accounts.startEdit(screen.account)}
          onNewFolder={() => folders.startCreate(screen.account)}
          onSenders={() => senders.show(screen.account)}
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
          onOlder={() => navigator.loadOlderMessages(screen.account, screen.folder)}
          onTools={() => folders.startTools(screen.account, screen.folder)}
          onThread={(thread) =>
            messages.showThread({
              subject: thread[0].subject,
              origin: 'folder',
              returnTo: screen,
              items: thread.map((message) => ({ message, accountId: screen.account.id, folderId: screen.folder.id }))
            })
          }
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
          onSnooze={(until) => messages.snooze(screen, until)}
          onUnsnooze={() => messages.unsnooze(screen)}
          onCreateTag={(name, color) => tags.create(name, color)}
          onReply={() => compose.startReply(screen)}
          onReplyAll={() => compose.startReplyAll(screen)}
          onForward={() => compose.startForward(screen)}
          onToggleSeen={() => messages.markUnread(screen)}
          onToggleFlag={() => messages.toggleFlagged(screen)}
          onMove={() => messages.startMove(screen)}
          onArchive={() => messages.archive(screen)}
          onJunk={() => messages.markAsJunk(screen)}
          onSource={() => messages.showSource(screen)}
          onPrint={() => messages.print(screen)}
          onAddContact={() => messages.addSenderToContacts(screen)}
          onAddTask={() => messages.addToTasks(screen, (link, subject) => tasks.addMessage(link, subject))}
          onSaveSource={() => messages.saveSource(screen)}
          onFindKey={(address) => keys.findFor(address)}
          onDelete={() => messages.delete(screen)}
          onSave={(attachment) => messages.saveAttachment(screen, attachment)}
          onOpenAttachment={(attachment) => messages.openAttachment(screen, attachment)}
          onTakeKey={(attachment) => void keys.takeFrom(screen.source, attachment)}
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
          onSend={(draft, sendAt) => compose.send(screen, draft, sendAt)}
          suggest={(typed) => compose.suggest(typed)}
          onSaveDraft={(draft) => compose.saveDraft(screen, draft)}
          onAutosave={(draft) => compose.autosave(screen, draft)}
          onCancel={(draft) => compose.cancel(screen, draft)}
          onDiscard={(draft) => compose.discard(screen, draft)}
        />
      )
    case 'tags':
      return (
        <TagsScreen
          counts={screen.counts}
          onBack={() => settings.show()}
          onMove={(tag, by) => void tags.move(tag.id, by)}
          onSave={(tag, name, color) => void (tag ? tags.update(tag.id, name, color) : tags.create(name, color))}
          onDelete={(tag) => void tags.remove(tag.id)}
        />
      )
    case 'tasks':
      return (
        <TasksScreen
          state={screen}
          onBack={() => navigator.showAccounts()}
          onAdd={(title, repeat) => tasks.add(title, repeat)}
          onDone={(id, done) => tasks.setDone(id, done)}
          onItem={(itemId, done) => tasks.setItem(itemId, done)}
          onAddItem={(taskId, title) => tasks.addItem(taskId, title)}
          onRemoveItem={(itemId) => tasks.removeItem(itemId)}
          onDefer={(id) => tasks.defer(id)}
          onRemove={(id) => tasks.remove(id)}
          onOpenMessage={(task) => (task.link ? tasks.openMessage(task.link) : undefined)}
        />
      )
    case 'filterRules':
      return (
        <FilterRulesScreen
          state={screen}
          onAccount={(accountId) => filters.show(accountId)}
          onSave={(input, id) => filters.save(screen.account.id, input, id)}
          onRemove={(id) => filters.remove(screen.account.id, id)}
          onEnabled={(id, enabled) => filters.setEnabled(screen.account.id, id, enabled)}
          onMove={(id, direction) => filters.move(screen.account.id, id, direction)}
          onApply={(id) => filters.applyNow(screen.account.id, id)}
          onBack={() => settings.show()}
        />
      )
    case 'contacts':
      return (
        <ContactsScreen
          state={screen}
          onSave={(id, fields) => contacts.save(id, fields)}
          onRemove={(id) => contacts.remove(id)}
          onImport={() => contacts.importFile()}
          onExport={(id) => contacts.exportFile(id)}
          onBack={() => settings.show()}
        />
      )
    case 'thread':
      return <ThreadScreen state={screen} onOpen={(item) => messages.openFromThread(screen, item)} onBack={() => messages.closeThread(screen)} />
    case 'source':
      return <SourceScreen state={screen} onBack={() => messages.closeSource(screen)} />
    case 'scheduled':
      return <ScheduledScreen state={screen} onTakeBack={(id) => compose.takeBack(screen, id)} onBack={() => compose.leaveScheduled(screen)} />
    case 'identities':
      return (
        <IdentitiesScreen
          key={screen.account.id}
          state={screen}
          onSave={(id, fields) => senders.save(screen, id, fields)}
          onMakeDefault={(id) => senders.makeDefault(screen, id)}
          onRemove={(id) => senders.remove(screen, id)}
          onBack={() => senders.back(screen.account)}
        />
      )
    case 'folderTools':
      return (
        <FolderToolsScreen
          // Another folder is another screen: what was typed is not carried over.
          key={screen.folder?.id ?? 'new'}
          state={screen}
          onCreate={(name, parentPath) => folders.create(screen, name, parentPath)}
          onRename={(name) => folders.rename(screen, name)}
          onDelete={() => folders.remove(screen)}
          onMarkAllRead={() => folders.markAllRead(screen)}
          onEmpty={() => folders.empty(screen)}
          onBack={() => folders.back(screen)}
        />
      )
    case 'editAccount':
      return (
        <EditAccountScreen
          key={screen.account.id}
          state={screen}
          onSave={(fields) => accounts.save(screen.account, fields)}
          onBack={() => navigator.showStoredFolders(screen.account)}
        />
      )
    case 'keys':
      return (
        <KeysScreen
          state={screen}
          onBack={() => settings.show()}
          onGenerate={(accountId) => void keys.generate(accountId)}
          onPickFile={() => void keys.pickFile()}
          onPasted={(text) => void keys.scan(text)}
          onSearch={(address) => void keys.search(address)}
          onAdoptOwn={(fingerprint, accountId, passphrase) => void keys.adoptOwn(fingerprint, accountId, passphrase)}
          onAdoptContact={(fingerprint, address) => void keys.adoptContact(fingerprint, address)}
          onDismiss={(fingerprint) => void keys.dismiss(fingerprint)}
          onRemoveOwn={(accountId, fingerprint) => void keys.removeOwn(accountId, fingerprint)}
          onRemoveContact={(fingerprint) => void keys.removeContact(fingerprint)}
          onExport={(accountId, fingerprint) => void keys.exportPublic(accountId, fingerprint)}
          onPublish={(accountId, fingerprint) => void keys.publish(accountId, fingerprint)}
          onDefault={(which, on) => void keys.setDefault(which, on)}
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
          onDeviceContacts={(on) => settings.setDeviceContacts(on)}
          onUndoSeconds={(seconds) => settings.setUndoSeconds(seconds)}
          onSafety={(change) => settings.setSafety(change)}
          onAppearance={(mode) => settings.setAppearance(mode)}
          onFontScale={(scale) => settings.setFontScale(scale)}
          onLanguage={(choice) => settings.setLanguage(choice)}
          onLook={(change) => settings.setLook(change)}
          onLock={(on) => settings.setLock(on)}
          onContacts={() => contacts.show()}
          onFilters={() => filters.show()}
          onConversations={(on) => settings.setConversations(on)}
          onLockDelay={(seconds) => settings.setLockDelay(seconds)}
          onTags={() => void tags.show()}
          onKeys={() => void keys.show()}
          onQuietHours={(on) => settings.setQuietHours(on)}
          onQuietTime={(end, value) => settings.setQuietTime(end, value)}
          onMuted={(accountId) => settings.toggleMuted(accountId)}
          onInterval={(minutes) => settings.setInterval(minutes)}
          onRunNow={() => settings.runNow()}
          onKeepConnection={(on) => settings.setKeepConnection(on)}
          onBatterySettings={() => settings.openBatterySettings()}
        />
      )
  }
}
