import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import type { FolderToolsState } from '../app/screens'
import { isChangeable, isEmptiable } from '../folderOps'
import { Button, Spinner } from './controls'
import { Dropdown } from './Dropdown'
import { Icon } from './Icon'
import { ConfirmDialog } from './ConfirmDialog'
import { FormInput, FormScroll } from './FormScroll'
import { Header } from './Header'
import { folderLabel } from './folderLabel'
import { useStyles } from './useStyles'
import { useTheme } from './useTheme'
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
  const { colors } = useTheme()
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
    const places = [{ value: '', label: t('Oben') }, ...folders.map((candidate) => ({ value: candidate.imapPath, label: candidate.imapPath }))]
    return (
      <FormScroll>
        {header}
        {status}
        <FormInput placeholder={t('Name des Ordners')} autoCapitalize="none" value={name} onChangeText={setName} />
        <Dropdown caption={t('Wo')} value={parentPath ?? ''} options={places} onChange={(place) => setParentPath(place === '' ? null : place)} />
        <Button label={t('Ordner anlegen')} disabled={busy === true || name.trim() === ''} onPress={() => props.onCreate(name, parentPath)} />
      </FormScroll>
    )
  }

  const renamed = name.trim() !== '' && name.trim() !== folder.displayName
  return (
    <FormScroll>
      {header}
      {status}

      <Text style={styles.section}>{t('Nachrichten')}</Text>
      <View style={styles.menuCard}>
        <Pressable accessibilityRole="button" disabled={busy === true} style={[styles.menuRow, !isEmptiable(folder) && styles.menuRowLast]} onPress={props.onMarkAllRead}>
          <Icon name="check" size={18} color={colors.accent} />
          <Text style={styles.menuText}>{t('Alle als gelesen markieren')}</Text>
        </Pressable>
        {isEmptiable(folder) ? (
          <Pressable accessibilityRole="button" disabled={busy === true} style={[styles.menuRow, styles.menuRowLast]} onPress={() => setQuestion('empty')}>
            <Icon name="trash" size={18} color={colors.danger} />
            <Text style={styles.menuTextDanger}>{t('Ordner leeren')}</Text>
          </Pressable>
        ) : null}
      </View>

      <Text style={styles.section}>{t('Ordner')}</Text>
      {isChangeable(folder) ? (
        <>
          <View style={styles.fieldRow}>
            <View style={{ flex: 1 }}>
              <FormInput placeholder={t('Name des Ordners')} autoCapitalize="none" value={name} onChangeText={setName} />
            </View>
            <Pressable accessibilityRole="button" disabled={busy === true || !renamed} style={styles.smallAction} onPress={() => props.onRename(name)}>
              <Text style={renamed ? styles.smallActionText : styles.hint}>{t('Umbenennen')}</Text>
            </Pressable>
          </View>
          <View style={styles.menuCard}>
            <Pressable accessibilityRole="button" disabled={busy === true} style={[styles.menuRow, styles.menuRowLast]} onPress={() => setQuestion('delete')}>
              <Icon name="trash" size={18} color={colors.danger} />
              <Text style={styles.menuTextDanger}>{t('Ordner löschen')}</Text>
            </Pressable>
          </View>
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
