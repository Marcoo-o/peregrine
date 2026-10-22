import { useState } from 'react'
import { Switch, Text, View } from 'react-native'
import type { SettingsState } from '../app/screens'
import { hasQuietHours, INTERVAL_CHOICES } from '../settings'
import { Button, Chip } from './controls'
import { FormInput, FormScroll } from './FormScroll'
import { Header } from './Header'
import { intervalLabel } from './intervalLabel'
import { useStyles } from './useStyles'
import { useTheme } from './useTheme'

type QuietEnd = 'quietFrom' | 'quietTo'

/** A line with a label and a switch, the shape most settings have. */
function SwitchRow(props: { label: string; value: boolean; disabled?: boolean; onChange: (value: boolean) => void }) {
  const styles = useStyles()
  const { colors } = useTheme()
  return (
    <View style={styles.setting}>
      <Text style={styles.settingLabel}>{props.label}</Text>
      <Switch
        value={props.value}
        disabled={props.disabled}
        onValueChange={props.onChange}
        trackColor={{ false: colors.border, true: colors.accent }}
        thumbColor={props.value ? colors.onAccent : colors.muted}
      />
    </View>
  )
}

/** One end of the quiet hours. It is taken when the user is done typing, and only if it is a time of day. */
function TimeField(props: { label: string; value: string; onDone: (value: string) => void }) {
  const styles = useStyles()
  const [typed, setTyped] = useState(props.value)
  return (
    <View style={styles.setting}>
      <Text style={styles.settingLabel}>{props.label}</Text>
      <FormInput
        style={styles.timeInput}
        value={typed}
        placeholder="HH:MM"
        keyboardType="numbers-and-punctuation"
        onChangeText={setTyped}
        onEndEditing={() => props.onDone(typed)}
      />
    </View>
  )
}

export function SettingsScreen(props: {
  state: SettingsState
  onBack: () => void
  onEnabled: (enabled: boolean) => void
  onPreview: (preview: boolean) => void
  onShowPreview: (show: boolean) => void
  onQuietHours: (on: boolean) => void
  onQuietTime: (end: QuietEnd, value: string) => void
  onMuted: (accountId: string) => void
  onInterval: (minutes: number) => void
  onRunNow: () => void
}) {
  const styles = useStyles()
  const { settings, list, accounts, permitted, notice } = props.state
  const quiet = hasQuietHours(settings)
  const off = !settings.enabled

  return (
    <FormScroll>
      <Header title="Einstellungen" back={{ label: 'Konten', onPress: props.onBack }} />

      <Text style={styles.section}>Listen</Text>
      <View style={styles.group}>
        <SwitchRow label="Text unter dem Betreff zeigen" value={list.showPreview} onChange={props.onShowPreview} />
      </View>

      <Text style={styles.section}>Benachrichtigungen</Text>
      <View style={styles.group}>
        <SwitchRow label="Neue Nachrichten melden" value={settings.enabled} onChange={props.onEnabled} />
        <SwitchRow label="Absender und Betreff zeigen" value={settings.preview} disabled={off} onChange={props.onPreview} />
        <SwitchRow label="Ruhezeiten" value={quiet} disabled={off} onChange={props.onQuietHours} />
        {quiet ? (
          <>
            <TimeField label="Von" value={settings.quietFrom} onDone={(value) => props.onQuietTime('quietFrom', value)} />
            <TimeField label="Bis" value={settings.quietTo} onDone={(value) => props.onQuietTime('quietTo', value)} />
          </>
        ) : null}
      </View>
      {settings.enabled && !permitted ? (
        <Text style={styles.error}>
          Das System lässt keine Benachrichtigungen von Peregrine zu. Das lässt sich in den Systemeinstellungen ändern.
        </Text>
      ) : null}
      {notice ? <Text style={styles.hint}>{notice}</Text> : null}

      <Text style={styles.section}>Abruf im Hintergrund, alle</Text>
      <View style={styles.actions}>
        {INTERVAL_CHOICES.map((minutes) => (
          <Chip
            key={minutes}
            label={intervalLabel(minutes)}
            active={settings.intervalMinutes === minutes}
            onPress={() => props.onInterval(minutes)}
          />
        ))}
      </View>
      <Text style={styles.hint}>
        Das System ruft frühestens alle 15 Minuten ab und später, wenn das Telefon ruhig liegt oder der Akku schwach ist.
      </Text>
      <Button label="Jetzt abrufen" variant="secondary" disabled={off} onPress={props.onRunNow} />

      <Text style={styles.section}>Konten, die melden</Text>
      <View style={styles.group}>
        {accounts.map((account) => (
          <SwitchRow
            key={account.id}
            label={account.displayName}
            value={!settings.mutedAccountIds.includes(account.id)}
            disabled={off}
            onChange={() => props.onMuted(account.id)}
          />
        ))}
      </View>
    </FormScroll>
  )
}
