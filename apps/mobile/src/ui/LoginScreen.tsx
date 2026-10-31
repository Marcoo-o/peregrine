import { useState } from 'react'
import { Linking, Text } from 'react-native'
import {
  initialFields,
  isSubmittable,
  looksLikeAddress,
  toAccountForm,
  withFound,
  withImapSecurity,
  withSmtpSecurity,
  type AccountForm,
  type FormFields
} from '../app/accountForm'
import { foundText, type FoundServers } from '../discovery'
import { Button, Spinner } from './controls'
import { FormInput, FormScroll } from './FormScroll'
import { Header } from './Header'
import { ServerFields } from './ServerFields'
import { useStyles } from './useStyles'
import { t } from '../i18n'

/** The form for a new account. It starts with what was typed last, so a failed sign-in is not typed again. */
export function LoginScreen(props: {
  error?: string
  previous?: AccountForm
  onSubmit: (form: AccountForm) => void
  /** Finds the servers of an address, where they are published. Asked for, not done on its own: it tells somebody the domain. */
  onFind: (email: string) => Promise<FoundServers | null>
  onCancel: () => void
}) {
  const styles = useStyles()
  const [fields, setFields] = useState<FormFields>(() => initialFields(props.previous))
  const set = (patch: Partial<FormFields>) => setFields((current) => ({ ...current, ...patch }))
  const [finding, setFinding] = useState(false)
  const [found, setFound] = useState<{ text: string; appPasswordUrl?: string } | null>(null)

  async function find(): Promise<void> {
    setFinding(true)
    setFound(null)
    try {
      const servers = await props.onFind(fields.email.trim())
      if (servers) setFields((current) => withFound(current, servers))
      setFound({ text: foundText(servers), appPasswordUrl: servers?.appPasswordUrl })
    } catch {
      setFound({ text: t('Die Suche ging schief. Trage die Server selbst ein.') })
    } finally {
      setFinding(false)
    }
  }

  return (
    <FormScroll>
      <Header title={t('Peregrine')} back={{ label: t('Konten'), onPress: props.onCancel }} />
      <Text style={styles.hint}>{t('Ein Konto per IMAP verbinden. Das Passwort bleibt verschlüsselt auf diesem Gerät.')}</Text>
      {props.error ? <Text style={styles.error}>{props.error}</Text> : null}
      <FormInput
        placeholder={t('E-Mail-Adresse (alex@example.org)')}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        value={fields.email}
        onChangeText={(email) => set({ email })}
      />
      <Button
        label={t('Einstellungen suchen')}
        variant="secondary"
        disabled={finding || !looksLikeAddress(fields.email)}
        onPress={() => void find()}
      />
      <Text style={styles.hint}>
        {t('Fragt den Anbieter der Adresse nach seinen Servern und, wenn er nichts veröffentlicht hat, die Datenbank von Mozilla. Dorthin geht nur die Domain. Nur wenn du auf den Knopf tippst.')}
      </Text>
      {finding ? <Spinner /> : null}
      {found ? <Text style={styles.hint}>{found.text}</Text> : null}
      {found?.appPasswordUrl ? (
        <Button label={t('App-Passwort anlegen')} variant="secondary" onPress={() => void Linking.openURL(found.appPasswordUrl as string)} />
      ) : null}
      <ServerFields
        hostPlaceholder={t('IMAP-Server (mail.example.org)')}
        portPlaceholder={t('Port')}
        host={fields.host}
        port={fields.port}
        secure={fields.secure}
        onHost={(host) => set({ host })}
        onPort={(port) => set({ port })}
        onSecure={(secure) => setFields((current) => withImapSecurity(current, secure))}
      />
      <FormInput
        placeholder={t('Benutzername')}
        autoCapitalize="none"
        autoCorrect={false}
        value={fields.username}
        onChangeText={(username) => set({ username })}
      />
      <FormInput
        placeholder={t('Passwort')}
        secureTextEntry
        autoCapitalize="none"
        value={fields.password}
        onChangeText={(password) => set({ password })}
      />
      <Text style={styles.hint}>
        {t('Zum Senden (SMTP). Ohne Server lässt sich mit diesem Konto nur lesen. Benutzername und Passwort sind die gleichen.')}
      </Text>
      <ServerFields
        hostPlaceholder={t('SMTP-Server (smtp.example.org)')}
        portPlaceholder="SMTP-Port"
        host={fields.smtpHost}
        port={fields.smtpPort}
        secure={fields.smtpSecure}
        onHost={(smtpHost) => set({ smtpHost })}
        onPort={(smtpPort) => set({ smtpPort })}
        onSecure={(secure) => setFields((current) => withSmtpSecurity(current, secure))}
      />
      <Button label={t('Verbinden')} disabled={!isSubmittable(fields)} onPress={() => props.onSubmit(toAccountForm(fields))} />
    </FormScroll>
  )
}
