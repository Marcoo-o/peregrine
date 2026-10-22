import { useState } from 'react'
import { FlatList, Text, View } from 'react-native'
import type { Tag } from '../tags'
import { Button } from './controls'
import { ConfirmDialog } from './ConfirmDialog'
import { Header } from './Header'
import { ListRow } from './ListRow'
import { TagEditor } from './TagEditor'
import { useTags } from './tags'
import { useStyles } from './useStyles'

/** The tags of the user, to be renamed, recoloured, forgotten, and made, as the settings of the desktop have them. */
export function TagsScreen(props: {
  onBack: () => void
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
      <Header title="Tags" back={{ label: 'Einstellungen', onPress: props.onBack }} />
      <Text style={styles.hint}>
        Ein Tag ist ein Schlüsselwort an der Nachricht auf dem Server. In Webmail und am Desktop ist es auch zu sehen.
      </Text>
      <FlatList
        data={tags}
        keyExtractor={(tag) => tag.id}
        ListEmptyComponent={<Text style={styles.hint}>Noch keine Tags.</Text>}
        renderItem={({ item }) => <ListRow title={item.name} meta={item.keyword} color={item.color} onPress={() => setEditing(item)} />}
      />
      <Button label="Neuer Tag" onPress={() => setEditing(null)} />
      {editing !== undefined ? (
        <TagEditor
          key={editing?.id ?? 'new'}
          tag={editing}
          onSave={(name, color) => {
            props.onSave(editing, name, color)
            setEditing(undefined)
          }}
          onDelete={editing ? () => setDeleting(editing) : undefined}
          onClose={() => setEditing(undefined)}
        />
      ) : null}
      <ConfirmDialog
        visible={deleting !== null}
        title={deleting ? `${deleting.name} löschen?` : ''}
        text={
          deleting
            ? `Die Nachrichten behalten das Schlüsselwort ${deleting.keyword} auf dem Server und zeigen es grau, unter diesem Namen. Es wird nirgends entfernt.`
            : ''
        }
        answers={[
          { label: 'Abbrechen', onPress: () => setDeleting(null) },
          {
            label: 'Tag löschen',
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
