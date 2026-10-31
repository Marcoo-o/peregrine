import { useState } from 'react'
import { Text, View } from 'react-native'
import type { FolderToolsState } from '../app/screens'
import { isChangeable, isEmptiable } from '../folderOps'
import { Button, Chip, Spinner } from './controls'
import { ConfirmDialog } from './ConfirmDialog'
import { FormInput, FormScroll } from './FormScroll'
import { Header } from './Header'
import { folderLabel } from './folderLabel'
import { useStyles } from './useStyles'
import { t } from '../i18n'

/** What the screen asks to be done, before it is asked again in a question: the things that cannot be taken back. */
type Question = 'delete' | 'empty' | null

/**
 * What can be done to one folder, or the making of a new one. The changes to the folder itself, a new name and deleting, are on top
 * for a folder that may have them and said to be impossible for one that has a job; what is done to the messages is under them.
 */
export function FolderToolsScreen(props: {
  state: FolderToolsState
  onCreate: (name: string, parentPath: string | null) => void
  onRename: (name: string) => void
  onDelete: () => void
  onMarkAllRead: () => void
  onEmpty: () => void
  onBack: () => void
}) {
  const styles = useStyles()
  const { account, folder, folders, busy, error, notice } = props.state
  const [name, setName] = useState(folder?.displayName ?? '')
  const [parentPath, setParentPath] = useState<string | null>(null)
  const [question, setQuestion] = useState<Question>(null)

  const header = <Header title={folder ? folderLabel(folder) : t('Neuer Ordner')} back={{ label: folder ? t('Ordner') : account.displayName, onPress: props.onBack }} />
  const status = (
    <>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {notice ? <Text style={styles.hint}>{notice}</Text> : null}
      {busy ? <Spinner /> : null}
    </>
  )

  if (!folder) {
    // Under which folder the new one sits: at the top, or in one of those the account has.
    return (
      <FormScroll>
        {header}
        {status}
        <FormInput placeholder={t('Name des Ordners')} autoCapitalize="none" value={name} onChangeText={setName} />
        <Text style={styles.section}>Wo</Text>
        <View style={styles.actions}>
          <Chip label={t('Oben')} active={parentPath === null} onPress={() => setParentPath(null)} />
          {folders.map((candidate) => (
            <Chip
              key={candidate.id}
              label={candidate.imapPath}
              active={parentPath === candidate.imapPath}
              onPress={() => setParentPath(candidate.imapPath)}
            />
          ))}
        </View>
        <Button label={t('Ordner anlegen')} disabled={busy === true || name.trim() === ''} onPress={() => props.onCreate(name, parentPath)} />
      </FormScroll>
    )
  }

  return (
    <FormScroll>
      {header}
      {status}

      <Text style={styles.section}>{t('Nachrichten')}</Text>
      <Button label={t('Alle als gelesen markieren')} variant="secondary" disabled={busy === true} onPress={props.onMarkAllRead} />
      {isEmptiable(folder) ? (
        <Button label={t('Ordner leeren')} variant="danger" disabled={busy === true} onPress={() => setQuestion('empty')} />
      ) : null}

      <Text style={styles.section}>{t('Ordner')}</Text>
      {isChangeable(folder) ? (
        <>
          <FormInput placeholder={t('Name des Ordners')} autoCapitalize="none" value={name} onChangeText={setName} />
          <Button
            label={t('Umbenennen')}
            disabled={busy === true || name.trim() === '' || name.trim() === folder.displayName}
            onPress={() => props.onRename(name)}
          />
          <Button label={t('Ordner löschen')} variant="danger" disabled={busy === true} onPress={() => setQuestion('delete')} />
        </>
      ) : (
        <Text style={styles.hint}>
          {t('Dieser Ordner hat eine feste Aufgabe, von der Archivieren, Löschen und Senden abhängen. Er lässt sich nicht umbenennen und nicht löschen.')}
        </Text>
      )}

      <ConfirmDialog
        visible={question === 'delete'}
        title={t('{displayName} löschen?', { displayName: folder.displayName })}
        text={t('Der Ordner und alle Nachrichten darin werden auf dem Mailserver gelöscht. Das lässt sich nicht rückgängig machen.')}
        answers={[
          { label: t('Abbrechen'), onPress: () => setQuestion(null) },
          {
            label: t('Ordner löschen'),
            variant: 'danger',
            onPress: () => {
              setQuestion(null)
              props.onDelete()
            }
          }
        ]}
      />
      <ConfirmDialog
        visible={question === 'empty'}
        title={t('{n} leeren?', { n: folderLabel(folder) })}
        text={t('Alle Nachrichten in diesem Ordner werden endgültig gelöscht, auch auf dem Mailserver.')}
        answers={[
          { label: t('Abbrechen'), onPress: () => setQuestion(null) },
          {
            label: t('Endgültig löschen'),
            variant: 'danger',
            onPress: () => {
              setQuestion(null)
              props.onEmpty()
            }
          }
        ]}
      />
    </FormScroll>
  )
}
