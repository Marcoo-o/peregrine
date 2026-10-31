import { useEffect, useState } from 'react'
import { FlatList, Text, TextInput, View } from 'react-native'
import type { SearchState } from '../app/screens'
import type { SearchHit } from '../search'
import { folderLabel } from './folderLabel'
import { Button } from './controls'
import { Header } from './Header'
import { MessageRow } from './MessageRow'
import { useStyles } from './useStyles'
import { useTheme } from './useTheme'
import { t, msg } from '../i18n'

/** How long typing has to stop before what was typed is searched for, so that a word is not searched for letter by letter. */
const TYPING_PAUSE_MS = 250

const HELP = msg(
  'Wörter suchen im Betreff, beim Absender und im Text der Nachrichten, die schon geladen sind. Dazu geht von:, betreff:, hat:anhang, ist:ungelesen, ist:markiert, tag:Name, vor:2026-10-01 und nach:2026-09-01. Mehrere Angaben grenzen weiter ein.'
)

const UNSUPPORTED: Record<SearchState['unsupported'][number], string> = {
  to: msg('Nach Empfängern (an:) lässt sich auf dem Handy noch nicht suchen. Die Suche lief ohne diese Angabe.')
}

/** Looking through the messages that are on the phone, with the syntax of the desktop's search. */
export function SearchScreen(props: {
  state: SearchState
  onSearch: (query: string) => void
  onOpen: (message: SearchHit) => void
  onBack: () => void
  /** Keeps the search, or takes the kept one away. */
  onSave: () => void
  onRemove: () => void
  /** Gives the kept search a name. */
  onRename: (name: string) => void
}) {
  const styles = useStyles()
  const { colors } = useTheme()
  const { query, messages, unsupported, saved, notice } = props.state
  const [typed, setTyped] = useState(query)
  const [naming, setNaming] = useState(false)
  const [called, setCalled] = useState('')

  // What is typed is searched for after a pause. It is not searched for again when it is what is shown already,
  // which it is when the screen has come back from a message.
  useEffect(() => {
    if (typed === query) return undefined
    const timer = setTimeout(() => props.onSearch(typed), TYPING_PAUSE_MS)
    return () => clearTimeout(timer)
  }, [typed, query, props])

  return (
    <View style={styles.fill}>
      <Header title={t('Suchen')} back={{ label: t('Konten'), onPress: props.onBack }} />
      <TextInput
        autoFocus={query === ''}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        placeholder={t('Suchen')}
        placeholderTextColor={colors.muted}
        style={styles.input}
        value={typed}
        onChangeText={setTyped}
      />
      {query.trim() !== '' ? (
        saved ? (
          <>
            <Button label={t('Aus der Seitenleiste entfernen')} variant="secondary" onPress={props.onRemove} />
            {naming ? (
              <>
                <TextInput
                  autoFocus
                  placeholder={t('Name in der Seitenleiste')}
                  placeholderTextColor={colors.muted}
                  style={styles.input}
                  value={called}
                  onChangeText={setCalled}
                  onSubmitEditing={() => {
                    props.onRename(called)
                    setNaming(false)
                  }}
                />
                <Button
                  label={t('Name speichern')}
                  variant="secondary"
                  onPress={() => {
                    props.onRename(called)
                    setNaming(false)
                  }}
                />
              </>
            ) : (
              <Button
                label={t('Umbenennen')}
                variant="secondary"
                onPress={() => {
                  setCalled(saved.name)
                  setNaming(true)
                }}
              />
            )}
          </>
        ) : (
          <Button label={t('Suche in der Seitenleiste behalten')} variant="secondary" onPress={props.onSave} />
        )
      ) : null}
      {notice ? <Text style={styles.hint}>{notice}</Text> : null}
      {unsupported.map((field) => (
        <Text key={field} style={styles.hint}>
          {t(UNSUPPORTED[field])}
        </Text>
      ))}
      <FlatList
        data={messages}
        keyboardShouldPersistTaps="handled"
        keyExtractor={(message) => `${message.folderId}:${message.uid}`}
        ListEmptyComponent={
          <Text style={styles.hint}>{query.trim() === '' ? t(HELP) : t('Nichts gefunden.')}</Text>
        }
        renderItem={({ item }) => (
          <MessageRow
            message={item}
            folderId={item.folderId}
            sender={item.sender}
            showPreview={props.state.showPreview}
            account={`${item.accountName}, ${folderLabel(item.folder)}`}
            accountColor={item.accountColor}
            pendingNote={item.pendingMoveTo ? t('wird verschoben, sobald es geht') : undefined}
            onPress={() => props.onOpen(item)}
          />
        )}
      />
    </View>
  )
}
