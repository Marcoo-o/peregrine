import { useState } from 'react'
import { View } from 'react-native'
import { insertLink, toggleLines, toggleWrap, type Edit, type Selection } from '../richText'
import { t } from '../i18n'
import { Button, Chip } from './controls'
import { FormInput } from './FormScroll'
import { useStyles } from './useStyles'

/**
 * The buttons for writing with formatting: each types the markers of `richText.ts` round the selection or before the lines it touches. A link asks for its
 * address first. What they change is handed back as the new text and the new selection, so that the cursor stays where the user was.
 */
export function FormatBar(props: {
  body: string
  selection: Selection
  previewing: boolean
  onEdit: (edit: Edit) => void
  onPreview: (on: boolean) => void
}) {
  const styles = useStyles()
  const [linking, setLinking] = useState(false)
  const [address, setAddress] = useState('https://')
  const { body, selection } = props
  const wrap = (marker: string) => props.onEdit(toggleWrap(body, selection, marker))
  const lines = (prefix: '- ' | '> ' | '# ' | '1. ') => props.onEdit(toggleLines(body, selection, prefix))

  return (
    <View>
      <View style={styles.actions}>
        <Chip label={t('Fett')} active={false} disabled={props.previewing} onPress={() => wrap('**')} />
        <Chip label={t('Kursiv')} active={false} disabled={props.previewing} onPress={() => wrap('_')} />
        <Chip label={t('Link')} active={linking} disabled={props.previewing} onPress={() => setLinking((now) => !now)} />
        <Chip label={t('Überschrift')} active={false} disabled={props.previewing} onPress={() => lines('# ')} />
        <Chip label={t('Liste')} active={false} disabled={props.previewing} onPress={() => lines('- ')} />
        <Chip label={t('Nummeriert')} active={false} disabled={props.previewing} onPress={() => lines('1. ')} />
        <Chip label={t('Zitat')} active={false} disabled={props.previewing} onPress={() => lines('> ')} />
        <Chip label={t('Vorschau')} active={props.previewing} onPress={() => props.onPreview(!props.previewing)} />
      </View>
      {linking && !props.previewing ? (
        <View>
          <FormInput placeholder={t('Adresse des Links')} autoCapitalize="none" autoCorrect={false} keyboardType="url" value={address} onChangeText={setAddress} />
          <Button
            label={t('Link einfügen')}
            disabled={!/^(https?:\/\/|mailto:)\S+/i.test(address.trim())}
            onPress={() => {
              props.onEdit(insertLink(body, selection, address.trim()))
              setLinking(false)
              setAddress('https://')
            }}
          />
        </View>
      ) : null}
    </View>
  )
}
