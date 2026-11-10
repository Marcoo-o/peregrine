import { useState } from 'react'
import { Text } from 'react-native'
import type { BackupOptions } from '../backup'
import type { BackupState } from '../app/screens'
import { MIN_PASSWORD } from '../app/BackupController'
import { t } from '../i18n'
import { Button, Spinner, SwitchRow } from './controls'
import { FormInput, FormScroll } from './FormScroll'
import { Header } from './Header'
import { useStyles } from './useStyles'

/** A backup of what the user made, sealed with a password, and the putting back of one. */
export function BackupScreen(props: {
  state: BackupState
  onMake: (password: string, again: string, options: BackupOptions) => void
  onRestore: (password: string) => void
  onBack: () => void
}) {
  const styles = useStyles()
  const { notice, error, busy } = props.state
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const [passwords, setPasswords] = useState(false)
  const [privateKeys, setPrivateKeys] = useState(true)
  const [opening, setOpening] = useState('')
  const idle = busy === undefined

  return (
    <FormScroll>
      <Header title={t('Sicherung')} back={{ label: t('Einstellungen'), onPress: props.onBack }} />
      {busy ? (
        <>
          <Spinner />
          <Text style={styles.hint}>{busy}</Text>
        </>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {notice ? <Text style={styles.hint}>{notice}</Text> : null}
      <Text style={styles.hint}>
        {t('Eine Datei mit dem, was du gemacht hast und vom Server nicht zurückbekommst: Konten, Absender, Schlüssel, Kontakte, Tags, Regeln, Aufgaben und Einstellungen. Die Nachrichten sind nicht darin, die hat der Server.')}
      </Text>

      <Text style={styles.section}>{t('Sichern')}</Text>
      <FormInput placeholder={t('Passwort für die Datei')} secureTextEntry autoCapitalize="none" autoCorrect={false} value={password} onChangeText={setPassword} />
      <FormInput placeholder={t('Passwort noch einmal')} secureTextEntry autoCapitalize="none" autoCorrect={false} value={again} onChangeText={setAgain} />
      <Text style={styles.hint}>{t('Mindestens {n} Zeichen. Ohne dieses Passwort lässt sich die Datei nicht öffnen, und es gibt keinen Weg um es herum.', { n: MIN_PASSWORD })}</Text>
      <SwitchRow label={t('Private Schlüssel einschließen')} hint={t('Ohne sie lässt sich verschlüsselte Post auf einem neuen Telefon nicht lesen.')} value={privateKeys} onChange={setPrivateKeys} />
      <SwitchRow label={t('Passwörter der Konten einschließen')} hint={t('Sonst musst du sie nach dem Zurückspielen neu eingeben.')} value={passwords} onChange={setPasswords} />
      <Button label={t('Sicherung speichern')} disabled={!idle || password === ''} onPress={() => props.onMake(password, again, { passwords, privateKeys })} />

      <Text style={styles.section}>{t('Zurückspielen')}</Text>
      <Text style={styles.hint}>{t('Fügt hinzu, was fehlt, und lässt alles, was schon da ist, wie es ist. Du kannst eine Sicherung also auch auf ein Telefon spielen, das schon benutzt wird.')}</Text>
      <FormInput placeholder={t('Passwort der Sicherung')} secureTextEntry autoCapitalize="none" autoCorrect={false} value={opening} onChangeText={setOpening} />
      <Button label={t('Sicherung wählen')} variant="secondary" disabled={!idle || opening === ''} onPress={() => props.onRestore(opening)} />
    </FormScroll>
  )
}
