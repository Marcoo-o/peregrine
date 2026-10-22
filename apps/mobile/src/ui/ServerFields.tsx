import { View } from 'react-native'
import type { FormSecurity } from '../app/accountForm'
import { Chip } from './controls'
import { FormInput } from './FormScroll'
import { useStyles } from './useStyles'

/** The three fields that name a server: its address, how to connect to it, and the port. */
export function ServerFields(props: {
  hostPlaceholder: string
  portPlaceholder: string
  host: string
  port: string
  secure: FormSecurity
  onHost: (host: string) => void
  onPort: (port: string) => void
  onSecure: (secure: FormSecurity) => void
}) {
  const styles = useStyles()
  return (
    <>
      <FormInput
        placeholder={props.hostPlaceholder}
        autoCapitalize="none"
        autoCorrect={false}
        value={props.host}
        onChangeText={props.onHost}
      />
      <View style={styles.row}>
        <Chip label="TLS" active={props.secure === 'tls'} onPress={() => props.onSecure('tls')} />
        <Chip label="STARTTLS" active={props.secure === 'starttls'} onPress={() => props.onSecure('starttls')} />
      </View>
      <FormInput
        placeholder={props.portPlaceholder}
        keyboardType="number-pad"
        value={props.port}
        onChangeText={props.onPort}
      />
    </>
  )
}
