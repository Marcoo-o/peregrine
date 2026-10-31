import { Text, View } from 'react-native'
import { parseAddress } from '@peregrine/smtp/headers'
import { senderName } from '../senderName'
import { useStyles } from './useStyles'
import { t } from '../i18n'

/** Who a message is from: a circle in the colour of the account it came to, the name, the address, and who else it went to. */
export function SenderBlock(props: { from: string; to: string; cc: string; color: string }) {
  const styles = useStyles()
  const name = senderName(props.from)
  const { address } = parseAddress(props.from)
  const recipients = [props.to && `An: ${props.to}`, props.cc && t('Kopie: {cc}', { cc: props.cc })].filter(Boolean).join('\n')
  return (
    <View>
      <View style={styles.senderRow}>
        <View style={[styles.avatar, { backgroundColor: props.color }]}>
          <Text style={styles.avatarText}>{(name || '?').charAt(0).toUpperCase()}</Text>
        </View>
        <View style={styles.fill}>
          <Text style={styles.senderName} numberOfLines={1}>
            {name}
          </Text>
          {address && address !== name ? (
            <Text style={styles.senderAddress} numberOfLines={1}>
              {address}
            </Text>
          ) : null}
        </View>
      </View>
      {recipients ? (
        <Text style={styles.itemMeta} numberOfLines={3}>
          {recipients}
        </Text>
      ) : null}
    </View>
  )
}
