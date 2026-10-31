import { useState } from 'react'
import { FlatList, Text, View } from 'react-native'
import type { Tag } from '../tags'
import { Button } from './controls'
import { ConfirmDialog } from './ConfirmDialog'
import { Header } from './Header'
import { ListRow } from './ListRow'
import { TagEditor } from './TagEditor'
import { tagMeta } from './tagMeta'
import { useTags } from './tags'
import { useStyles } from './useStyles'
import { t } from '../i18n'

/** The tags of the user, to be renamed, recoloured, forgotten, and made, as the settings of the desktop have them. */
export function TagsScreen(props: {
  /** How many messages have each tag, by its keyword in lower case. */
  counts: Record<string, number>
  onBack: () => void
  /** Moves a tag one place up or down among the others. */
  onMove: (tag: Tag, by: -1 | 1) => void
  /** Makes a tag, or changes the one given. */
  onSave: (tag: Tag | null, name: string, color: string) => void
  onDelete: (tag: Tag) => void
}) {
  const styles = useStyles()
  const tags = useTags()
  // The tag that is open in the editor: one that is changed, or null for one that is made, or undefined for none.
  const [editing, setEditing] = useState<Tag | null | undefined>(undefined)
  const [deleting, setDeleting] = useState<Tag | null>(null)
  return (
    <View style={styles.fill}>
      <Header title={t('Tags')} back={{ label: t('Einstellungen'), onPress: props.onBack }} />
      <Text style={styles.hint}>
        {t('Ein Tag ist ein Schlüsselwort an der Nachricht auf dem Server. In Webmail und am Desktop ist es auch zu sehen.')}
      </Text>
      <FlatList
        data={tags}
        keyExtractor={(tag) => tag.id}
        ListEmptyComponent={<Text style={styles.hint}>{t('Noch keine Tags.')}</Text>}
        renderItem={({ item }) => (
          <ListRow
            title={item.name}
            meta={tagMeta(item.keyword, props.counts[item.keyword.toLowerCase()] ?? 0)}
            color={item.color}
            onPress={() => setEditing(item)}
          />
        )}
      />
      <Button label={t('Neuer Tag')} onPress={() => setEditing(null)} />
      {editing !== undefined ? (
        <TagEditor
          key={editing?.id ?? 'new'}
          tag={editing}
          onSave={(name, color) => {
            props.onSave(editing, name, color)
            setEditing(undefined)
          }}
          onDelete={editing ? () => setDeleting(editing) : undefined}
          position={editing ? { index: tags.findIndex((tag) => tag.id === editing.id), of: tags.length } : undefined}
          onMove={editing ? (by) => props.onMove(editing, by) : undefined}
          onClose={() => setEditing(undefined)}
        />
      ) : null}
      <ConfirmDialog
        visible={deleting !== null}
        title={deleting ? t('{name} löschen?', { name: deleting.name }) : ''}
        text={
          deleting
            ? t('Die Nachrichten behalten das Schlüsselwort {keyword} auf dem Server und zeigen es grau, unter diesem Namen. Es wird nirgends entfernt.', { keyword: deleting.keyword })
            : ''
        }
        answers={[
          { label: t('Abbrechen'), onPress: () => setDeleting(null) },
          {
            label: t('Tag löschen'),
            variant: 'danger',
            onPress: () => {
              if (deleting) props.onDelete(deleting)
              setDeleting(null)
              setEditing(undefined)
            }
          }
        ]}
      />
    </View>
  )
}
