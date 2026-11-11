import { useState } from 'react'
import { Text, View } from 'react-native'
import type { AutoBackupSettings } from '../autoBackup'
import { KEEP_CHOICES } from '../autoBackup'
import type { BackupOptions } from '../backup'
import type { BackupState } from '../app/screens'
import { MIN_PASSWORD } from '../app/BackupController'
import { INTERVALS } from '../backupSchedule'
import { msg, t, tn } from '../i18n'
import { Button, Spinner, SwitchRow } from './controls'
import { Dropdown } from './Dropdown'
import { FormInput, FormScroll } from './FormScroll'
import { Header } from './Header'
import { useStyles } from './useStyles'

const INTERVAL_LABELS: Record<number, string> = { 1: msg('Täglich'), 7: msg('Wöchentlich'), 14: msg('Alle 2 Wochen'), 28: msg('Alle 4 Wochen') }
const WEEKDAYS = [msg('Sonntag'), msg('Montag'), msg('Dienstag'), msg('Mittwoch'), msg('Donnerstag'), msg('Freitag'), msg('Samstag')]
const MINUTES = [0, 15, 30, 45]
const two = (n: number): string => String(n).padStart(2, '0')

/** A backup of what the user made, sealed with a password, the putting back of one, and the scheduled backup into a folder. */
export function BackupScreen(props: {
  state: BackupState
  onMake: (password: string, again: string, options: BackupOptions) => void
  onRestore: (password: string) => void
  onAuto: (change: Partial<AutoBackupSettings>) => void
  onChooseFolder: () => void
  onRememberPassword: (password: string) => void
  onForgetPassword: () => void
  onRunAuto: () => void
  onBack: () => void
}) {
  const styles = useStyles()
  const { notice, error, busy, auto } = props.state
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const [passwords, setPasswords] = useState(false)
  const [privateKeys, setPrivateKeys] = useState(true)
  const [opening, setOpening] = useState('')
  const [autoPassword, setAutoPassword] = useState('')
  const idle = busy === undefined
  const { settings } = auto
  const ready = auto.folder !== null && auto.hasPassword

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

      <Text style={styles.section}>{t('Automatisch sichern')}</Text>
      <Text style={styles.hint}>{t('Der Ordner und das Passwort werden einmal gewählt. Danach macht das Telefon die Sicherung von selbst, auch wenn die App geschlossen ist, und behält die letzten Dateien.')}</Text>
      <View style={styles.group}>
        <SwitchRow label={t('Automatisch sichern')} value={settings.enabled} disabled={!idle} onChange={(enabled) => props.onAuto({ enabled })} />
      </View>
      <Button label={auto.folder ? t('Ordner: {name}', { name: auto.folder }) : t('Ordner wählen')} variant="secondary" disabled={!idle} onPress={props.onChooseFolder} />
      {auto.hasPassword ? (
        <Button label={t('Passwort vergessen')} variant="secondary" disabled={!idle} onPress={props.onForgetPassword} />
      ) : (
        <>
          <FormInput placeholder={t('Passwort für die Dateien')} secureTextEntry autoCapitalize="none" autoCorrect={false} value={autoPassword} onChangeText={setAutoPassword} />
          <Button
            label={t('Passwort merken')}
            variant="secondary"
            disabled={!idle || autoPassword.length < MIN_PASSWORD}
            onPress={() => {
              props.onRememberPassword(autoPassword)
              setAutoPassword('')
            }}
          />
        </>
      )}
      {ready ? (
        <>
          <View style={styles.fieldRow}>
            <Dropdown
              caption={t('Wie oft')}
              value={String(settings.intervalDays)}
              options={INTERVALS.map((days) => ({ value: String(days), label: t(INTERVAL_LABELS[days]) }))}
              onChange={(value) => props.onAuto({ intervalDays: Number(value) })}
            />
            {settings.intervalDays > 1 ? (
              <Dropdown
                caption={t('Wochentag')}
                value={String(settings.weekday)}
                options={WEEKDAYS.map((label, day) => ({ value: String(day), label: t(label) }))}
                onChange={(value) => props.onAuto({ weekday: Number(value) })}
              />
            ) : null}
          </View>
          <View style={styles.fieldRow}>
            <Dropdown
              caption={t('Uhrzeit')}
              value={String(settings.hour)}
              options={Array.from({ length: 24 }, (_, hour) => ({ value: String(hour), label: two(hour) }))}
              onChange={(value) => props.onAuto({ hour: Number(value) })}
            />
            <Dropdown
              caption={t('Minute')}
              value={String(MINUTES.includes(settings.minute) ? settings.minute : 0)}
              options={MINUTES.map((minute) => ({ value: String(minute), label: two(minute) }))}
              onChange={(value) => props.onAuto({ minute: Number(value) })}
            />
          </View>
          <View style={styles.fieldRow}>
            <Dropdown
              caption={t('Behalten')}
              value={String(settings.keep)}
              options={KEEP_CHOICES.map((keep) => ({ value: String(keep), label: tn(keep, '{count} Datei', '{count} Dateien') }))}
              onChange={(value) => props.onAuto({ keep: Number(value) })}
            />
          </View>
          <View style={styles.group}>
            <SwitchRow label={t('Private Schlüssel einschließen')} value={settings.privateKeys} disabled={!idle} onChange={(on) => props.onAuto({ privateKeys: on })} />
            <SwitchRow label={t('Passwörter der Konten einschließen')} value={settings.passwords} disabled={!idle} onChange={(on) => props.onAuto({ passwords: on })} />
          </View>
          {settings.status ? <Text style={styles.hint}>{settings.status}</Text> : null}
          {settings.enabled ? <Button label={t('Jetzt sichern')} variant="secondary" disabled={!idle} onPress={props.onRunAuto} /> : null}
        </>
      ) : null}

      <Text style={styles.section}>{t('Von Hand sichern')}</Text>
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
