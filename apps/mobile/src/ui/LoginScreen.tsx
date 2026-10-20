import { useState } from 'react'
import { Text } from 'react-native'
import {
  initialFields,
  isSubmittable,
  toAccountForm,
  withImapSecurity,
  withSmtpSecurity,
  type AccountForm,
  type FormFields
} from '../app/accountForm'
import { BackLink, Button } from './controls'
import { FormInput, FormScroll } from './FormScroll'
import { ServerFields } from './ServerFields'
import { styles } from './styles'

/** The form for a new account. It starts with what was typed last, so a failed sign-in is not typed again. */
export function LoginScreen(props: {
  error?: string
  previous?: AccountForm
  onSubmit: (form: AccountForm) => void
  onCancel: () => void
}) {
  const [fields, setFields] = useState<FormFields>(() => initialFields(props.previous))
  const set = (patch: Partial<FormFields>) => setFields((current) => ({ ...current, ...patch }))

  return (
    <FormScroll>
      <Text style={styles.title}>Peregrine</Text>
      <Text style={styles.hint}>Ein Konto per IMAP verbinden. Das Passwort bleibt verschlüsselt auf diesem Gerät.</Text>
      {props.error ? <Text style={styles.error}>{props.error}</Text> : null}
      <FormInput
        placeholder="E-Mail-Adresse (alex@example.org)"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        value={fields.email}
        onChangeText={(email) => set({ email })}
      />
      <ServerFields
        hostPlaceholder="IMAP-Server (mail.example.org)"
        portPlaceholder="Port"
        host={fields.host}
        port={fields.port}
        secure={fields.secure}
        onHost={(host) => set({ host })}
        onPort={(port) => set({ port })}
        onSecure={(secure) => setFields((current) => withImapSecurity(current, secure))}
      />
      <FormInput
        placeholder="Benutzername"
        autoCapitalize="none"
        autoCorrect={false}
        value={fields.username}
        onChangeText={(username) => set({ username })}
      />
      <FormInput
        placeholder="Passwort"
        secureTextEntry
        autoCapitalize="none"
        value={fields.password}
        onChangeText={(password) => set({ password })}
      />
      <Text style={styles.hint}>
        Zum Senden (SMTP). Ohne Server lässt sich mit diesem Konto nur lesen. Benutzername und Passwort sind die gleichen.
      </Text>
      <ServerFields
        hostPlaceholder="SMTP-Server (smtp.example.org)"
        portPlaceholder="SMTP-Port"
        host={fields.smtpHost}
        port={fields.smtpPort}
        secure={fields.smtpSecure}
        onHost={(smtpHost) => set({ smtpHost })}
        onPort={(smtpPort) => set({ smtpPort })}
        onSecure={(secure) => setFields((current) => withSmtpSecurity(current, secure))}
      />
      <Button label="Verbinden" disabled={!isSubmittable(fields)} onPress={() => props.onSubmit(toAccountForm(fields))} />
      <BackLink label="‹ Zurück zu den Konten" onPress={props.onCancel} />
    </FormScroll>
  )
}
