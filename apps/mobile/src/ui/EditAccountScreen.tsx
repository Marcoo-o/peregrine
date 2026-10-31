import { useState } from 'react'
import { Text, View } from 'react-native'
import { ACCOUNT_COLORS } from '@peregrine/core/accountColors'
import {
  editFieldsOf,
  isEditSubmittable,
  withImapSecurity,
  withSmtpSecurity,
  type EditFields
} from '../app/accountForm'
import type { EditAccountState } from '../app/screens'
import { Button, Chip, Spinner } from './controls'
import { FormInput, FormScroll } from './FormScroll'
import { Header } from './Header'
import { ServerFields } from './ServerFields'
import { useStyles } from './useStyles'
import { t } from '../i18n'

/** Changing an account: what it is called and how it is coloured, and the servers and logins for reading and for sending. */
export function EditAccountScreen(props: { state: EditAccountState; onSave: (fields: EditFields) => void; onBack: () => void }) {
  const styles = useStyles()
  const { account, busy, error } = props.state
  const [fields, setFields] = useState<EditFields>(() => editFieldsOf(account))
  const set = (patch: Partial<EditFields>) => setFields((current) => ({ ...current, ...patch }))

  return (
    <FormScroll>
      <Header title={t('Konto bearbeiten')} back={{ label: account.displayName, onPress: props.onBack }} />
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Text style={styles.section}>{t('Konto')}</Text>
      <FormInput placeholder={t('Name des Kontos')} value={fields.displayName} onChangeText={(displayName) => set({ displayName })} />
      <FormInput
        placeholder={t('E-Mail-Adresse')}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        value={fields.email}
        onChangeText={(email) => set({ email })}
      />
      <Text style={styles.hint}>{t('Die Farbe, an der du das Konto in den Listen erkennst.')}</Text>
      <View style={styles.actions}>
        {ACCOUNT_COLORS.map((color) => (
          <Chip key={color} label={color === fields.color ? t('Gewählt') : ' '} dot={color} active={color === fields.color} onPress={() => set({ color })} />
        ))}
      </View>

      <Text style={styles.section}>{t('Lesen (IMAP)')}</Text>
      <ServerFields
        hostPlaceholder="IMAP-Server"
        portPlaceholder={t('Port')}
        host={fields.host}
        port={fields.port}
        secure={fields.secure}
        onHost={(host) => set({ host })}
        onPort={(port) => set({ port })}
        onSecure={(secure) => setFields((current) => (withImapSecurity(current, secure)))}
      />
      <FormInput placeholder={t('Benutzername')} autoCapitalize="none" autoCorrect={false} value={fields.username} onChangeText={(username) => set({ username })} />
      <FormInput
        placeholder={t('Passwort (leer lassen, wenn es bleibt)')}
        secureTextEntry
        autoCapitalize="none"
        value={fields.password}
        onChangeText={(password) => set({ password })}
      />

      <Text style={styles.section}>{t('Senden (SMTP)')}</Text>
      <Text style={styles.hint}>{t('Ohne Server lässt sich mit diesem Konto nur lesen. Benutzername und Passwort zum Senden bleiben leer, wenn sie die gleichen sind wie zum Lesen.')}</Text>
      <ServerFields
        hostPlaceholder="SMTP-Server"
        portPlaceholder="SMTP-Port"
        host={fields.smtpHost}
        port={fields.smtpPort}
        secure={fields.smtpSecure}
        onHost={(smtpHost) => set({ smtpHost })}
        onPort={(smtpPort) => set({ smtpPort })}
        onSecure={(secure) => setFields((current) => withSmtpSecurity(current, secure))}
      />
      <FormInput
        placeholder={t('Benutzername zum Senden (leer: wie zum Lesen)')}
        autoCapitalize="none"
        autoCorrect={false}
        value={fields.smtpUsername}
        onChangeText={(smtpUsername) => set({ smtpUsername })}
      />
      <FormInput
        placeholder={t('Passwort zum Senden (leer lassen, wenn es bleibt)')}
        secureTextEntry
        autoCapitalize="none"
        value={fields.smtpPassword}
        onChangeText={(smtpPassword) => set({ smtpPassword })}
      />

      {busy ? (
        <>
          <Spinner />
          <Text style={styles.hint}>{t('Die Verbindung wird geprüft, bevor etwas gespeichert wird.')}</Text>
        </>
      ) : null}
      <Button label={t('Prüfen und speichern')} disabled={busy === true || !isEditSubmittable(fields)} onPress={() => props.onSave(fields)} />
    </FormScroll>
  )
}
