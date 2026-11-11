import { useState, type ReactElement } from 'react'
import { Pressable, Text, View } from 'react-native'
import type { SettingsPage, SettingsState } from '../app/screens'
import { delayLabel, LOCK_DELAYS } from '../lock'
import { hasQuietHours, INTERVAL_CHOICES, UNDO_CHOICES } from '../settings'
import { APPEARANCE_CHOICES, appearance, DATE_FORMATS, DENSITIES, FONT_SCALES, fontScale, look, type AppearanceMode, type FontScale, type Look } from '../appearance'
import { ACCENTS, type AccentName } from './theme'
import type { SafetySettings } from '../safety'
import { useSafety } from './safety'
import { useSort } from './sort'
import { Button, Chip, SwitchRow } from './controls'
import { FormInput, FormScroll } from './FormScroll'
import { Header } from './Header'
import { intervalLabel } from './intervalLabel'
import { useStyles } from './useStyles'
import { useTheme } from './useTheme'
import { LANGUAGES, language, msg, t } from '../i18n'

type QuietEnd = 'quietFrom' | 'quietTo'

/** What each page is called, which is what the overview and the title of the page say. */
const PAGE_TITLES: Record<SettingsPage, string> = {
  appearance: msg('Aussehen und Sprache'),
  lists: msg('Listen und Senden'),
  addresses: msg('Adressen'),
  security: msg('Sicherheit'),
  notifications: msg('Benachrichtigungen')
}

/** The rows of the overview: a page each, and two that lead to a screen of their own. A line under each says what is on it. */
const OVERVIEW: Array<{ title: string; summary: string; page?: SettingsPage; action?: 'filters' | 'backup' }> = [
  { title: PAGE_TITLES.appearance, summary: msg('Hell oder dunkel, Farbe, Schrift, Sprache'), page: 'appearance' },
  { title: PAGE_TITLES.lists, summary: msg('Konversationen, Tags, Rückgängig beim Senden'), page: 'lists' },
  { title: PAGE_TITLES.addresses, summary: msg('Kontakte und Vorschläge'), page: 'addresses' },
  { title: PAGE_TITLES.security, summary: msg('App-Sperre, Links und Anhänge, Schlüssel'), page: 'security' },
  { title: PAGE_TITLES.notifications, summary: msg('Meldungen, Ruhezeiten, Abruf'), page: 'notifications' },
  { title: msg('Filterregeln'), summary: msg('Sortieren, was im Posteingang ankommt'), action: 'filters' },
  { title: msg('Sicherung'), summary: msg('Verschlüsselte Datei mit Konten, Schlüsseln und Einstellungen'), action: 'backup' }
]

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
  onDeviceContacts: (on: boolean) => void
  onUndoSeconds: (seconds: number) => void
  onSafety: (change: Partial<SafetySettings>) => void
  onAppearance: (mode: AppearanceMode) => void
  onFontScale: (scale: FontScale) => void
  onLanguage: (choice: string) => void
  onLook: (change: Partial<Look>) => void
  onLock: (on: boolean) => void
  onContacts: () => void
  onFilters: () => void
  onBackup: () => void
  onConversations: (on: boolean) => void
  onLockDelay: (seconds: number) => void
  onTags: () => void
  onKeys: () => void
  onQuietHours: (on: boolean) => void
  onQuietTime: (end: QuietEnd, value: string) => void
  onMuted: (accountId: string) => void
  onInterval: (minutes: number) => void
  onRunNow: () => void
  onKeepConnection: (on: boolean) => void
  onBatterySettings: () => void
  onPage: (page: SettingsPage) => void
}) {
  const styles = useStyles()
  const { settings, list, sending, lock, lockAvailable, contactsPermitted, accounts, permitted, push, notice, page } = props.state
  const safety = useSafety()
  const { conversations } = useSort()
  const quiet = hasQuietHours(settings)
  const off = !settings.enabled

  const pages: Record<SettingsPage, ReactElement> = {
    appearance: (
      <>
        <Text style={styles.section}>{t('Erscheinungsbild')}</Text>
        <View style={styles.actions}>
          {APPEARANCE_CHOICES.map((choice) => (
            <Chip key={choice.mode} label={t(choice.label)} active={appearance.mode === choice.mode} onPress={() => props.onAppearance(choice.mode)} />
          ))}
        </View>

        <Text style={styles.section}>{t('Akzentfarbe')}</Text>
        <View style={styles.actions}>
          {(Object.keys(ACCENTS) as AccentName[]).map((accent) => (
            <Chip key={accent} label={t(ACCENTS[accent].label)} dot={ACCENTS[accent].light} active={look.current.accent === accent} onPress={() => props.onLook({ accent })} />
          ))}
        </View>

        <Text style={styles.section}>{t('Datum in den Listen')}</Text>
        <View style={styles.actions}>
          {DATE_FORMATS.map((choice) => (
            <Chip key={choice.format} label={t(choice.label)} active={look.current.dateFormat === choice.format} onPress={() => props.onLook({ dateFormat: choice.format })} />
          ))}
        </View>

        <Text style={styles.section}>{t('Abstand in den Listen')}</Text>
        <View style={styles.actions}>
          {DENSITIES.map((choice) => (
            <Chip key={choice.density} label={t(choice.label)} active={look.current.density === choice.density} onPress={() => props.onLook({ density: choice.density })} />
          ))}
        </View>

        <Text style={styles.section}>{t('Sprache')}</Text>
        <View style={styles.actions}>
          <Chip label={t('Wie das Telefon')} active={language.choice === 'system'} onPress={() => props.onLanguage('system')} />
          {LANGUAGES.map((choice) => (
            <Chip key={choice.code} label={choice.name} active={language.choice === choice.code} onPress={() => props.onLanguage(choice.code)} />
          ))}
        </View>

        <Text style={styles.section}>{t('Schriftgröße')}</Text>
        <View style={styles.actions}>
          {FONT_SCALES.map((choice) => (
            <Chip key={choice.scale} label={t(choice.label)} active={fontScale.scale === choice.scale} onPress={() => props.onFontScale(choice.scale)} />
          ))}
        </View>
        <Text style={styles.hint}>{t('Kommt zu der Schriftgröße hinzu, die das Telefon in seinen Einstellungen hat.')}</Text>
      </>
    ),
    lists: (
      <>
        <Text style={styles.section}>{t('Listen')}</Text>
        <View style={styles.group}>
          <SwitchRow
            label={t('Antworten zu Konversationen zusammenfassen')}
            hint={t('Eine Zeile für alles, was zusammengehört, mit der neuesten Nachricht und der Zahl der Nachrichten.')}
            value={conversations}
            onChange={props.onConversations}
          />
          <SwitchRow label={t('Text unter dem Betreff zeigen')} value={list.showPreview} onChange={props.onShowPreview} />
        </View>
        <Button label={t('Tags verwalten')} variant="secondary" onPress={props.onTags} />

        <Text style={styles.section}>{t('Senden, Rückgängig möglich für')}</Text>
        <View style={styles.actions}>
          {UNDO_CHOICES.map((seconds) => (
            <Chip
              key={seconds}
              label={seconds === 0 ? t('Aus') : t('{seconds} Sekunden', { seconds })}
              active={sending.undoSeconds === seconds}
              onPress={() => props.onUndoSeconds(seconds)}
            />
          ))}
        </View>
        <Text style={styles.hint}>
          {t('Eine gesendete Nachricht wartet so lange, und bis dahin lässt sie sich zurücknehmen und weiterschreiben. Ist die Zeit um, geht sie ab.')}
        </Text>
      </>
    ),
    addresses: (
      <>
        <Button label={t('Kontakte verwalten')} variant="secondary" onPress={props.onContacts} />

        <View style={styles.group}>
          <SwitchRow label={t('Kontakte des Geräts vorschlagen')} value={list.deviceContacts} onChange={props.onDeviceContacts} />
        </View>
        <Text style={styles.hint}>
          {t('Beim Tippen einer Adresse schlägt Peregrine auch Personen aus dem Adressbuch des Geräts vor. Sie werden nur zum Vorschlagen gelesen und nirgends gespeichert.')}
        </Text>
        {list.deviceContacts && !contactsPermitted ? (
          <Text style={styles.error}>{t('Das System lässt das Lesen der Kontakte nicht zu. Das lässt sich in den Systemeinstellungen ändern.')}</Text>
        ) : null}
      </>
    ),
    security: (
      <>
        <Text style={styles.section}>{t('App-Sperre')}</Text>
        <View style={styles.group}>
          <SwitchRow
            label={t('Mit der Bildschirmsperre sperren')}
            hint={lockAvailable ? t('Die App zeigt keine Nachrichten, bis die Bildschirmsperre des Telefons eingegeben ist, und bleibt aus Bildschirmfotos und der Liste der letzten Apps heraus.') : t('Dieses Telefon hat keine Bildschirmsperre. Richte in den Systemeinstellungen eine ein.')}
            value={lock.enabled}
            disabled={!lockAvailable && !lock.enabled}
            onChange={props.onLock}
          />
        </View>
        {lock.enabled ? (
          <>
            <Text style={styles.section}>{t('Wieder fragen nach')}</Text>
            <View style={styles.actions}>
              {LOCK_DELAYS.map((seconds) => (
                <Chip key={seconds} label={delayLabel(seconds)} active={lock.afterSeconds === seconds} onPress={() => props.onLockDelay(seconds)} />
              ))}
            </View>
          </>
        ) : null}
        <Text style={styles.section}>{t('Sicherheit beim Lesen')}</Text>
        <View style={styles.group}>
          <SwitchRow
            label={t('Vor verdächtigen Links warnen')}
            hint={t('Ein Link, der nach einer anderen Adresse aussieht, als er führt, wird erst nach einer Rückfrage geöffnet.')}
            value={safety.warnSuspiciousLinks}
            onChange={(warnSuspiciousLinks) => props.onSafety({ warnSuspiciousLinks })}
          />
          <SwitchRow
            label={t('Vor jedem Link fragen')}
            hint={t('Auch die Links, an denen nichts auffällt.')}
            value={safety.confirmAllLinks}
            onChange={(confirmAllLinks) => props.onSafety({ confirmAllLinks })}
          />
          <SwitchRow
            label={t('Vor riskanten Anhängen warnen')}
            hint={t('Ein Anhang, der ein Programm starten würde oder nicht ist, was sein Name sagt, wird nicht an eine andere App weitergegeben.')}
            value={safety.warnRiskyAttachments}
            onChange={(warnRiskyAttachments) => props.onSafety({ warnRiskyAttachments })}
          />
        </View>
        <Text style={styles.section}>{t('Verschlüsselung')}</Text>
        <Button label={t('Schlüssel verwalten')} variant="secondary" onPress={props.onKeys} />
      </>
    ),
    notifications: (
      <>
        <View style={styles.group}>
          <SwitchRow label={t('Neue Nachrichten melden')} value={settings.enabled} onChange={props.onEnabled} />
          <SwitchRow label={t('Absender und Betreff zeigen')} value={settings.preview} disabled={off} onChange={props.onPreview} />
          <SwitchRow label={t('Ruhezeiten')} value={quiet} disabled={off} onChange={props.onQuietHours} />
          {quiet ? (
            <>
              <TimeField label={t('Von')} value={settings.quietFrom} onDone={(value) => props.onQuietTime('quietFrom', value)} />
              <TimeField label={t('Bis')} value={settings.quietTo} onDone={(value) => props.onQuietTime('quietTo', value)} />
            </>
          ) : null}
        </View>
        {settings.enabled && !permitted ? (
          <Text style={styles.error}>
            {t('Das System lässt keine Benachrichtigungen von Peregrine zu. Das lässt sich in den Systemeinstellungen ändern.')}
          </Text>
        ) : null}
        {notice ? <Text style={styles.hint}>{notice}</Text> : null}

        {/* Where the system tells the phone of new mail itself there is nothing to switch: it is there. */}
        {push.system ? null : (
          <>
            <Text style={styles.section}>{t('Sofort benachrichtigen')}</Text>
            <View style={styles.group}>
              <SwitchRow label={t('Verbindung offen halten')} value={push.keepConnection} disabled={off} onChange={props.onKeepConnection} />
            </View>
            <Text style={styles.hint}>
              {t('Peregrine hält die Verbindung zum Mailserver selbst offen und meldet neue Nachrichten sofort, statt im Abstand von Minuten oder Stunden. Solange das an ist, zeigt Android eine dauerhafte Benachrichtigung, und der Akku wird etwas stärker beansprucht. Damit die Verbindung auch hält, wenn das Telefon ruht, Peregrine von der Akkuoptimierung ausnehmen.')}
            </Text>
            {push.keepConnection ? <Button label={t('Akkuoptimierung öffnen')} variant="secondary" onPress={props.onBatterySettings} /> : null}
          </>
        )}

        <Text style={styles.section}>{t('Abruf im Hintergrund, alle')}</Text>
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
          {t('Das System ruft frühestens alle 15 Minuten ab und später, wenn das Telefon ruhig liegt oder der Akku schwach ist.')}
        </Text>
        <Button label={t('Jetzt abrufen')} variant="secondary" disabled={off} onPress={props.onRunNow} />

        <Text style={styles.section}>{t('Konten, die melden')}</Text>
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
      </>
    )
  }

  return (
    <FormScroll>
      <Header
        title={page === null ? t('Einstellungen') : t(PAGE_TITLES[page])}
        back={{ label: page === null ? t('Konten') : t('Einstellungen'), onPress: props.onBack }}
      />
      {page === null ? (
        <View style={styles.menuCard}>
          {OVERVIEW.map((row, index) => (
            <Pressable
              key={row.title}
              accessibilityRole="button"
              style={[styles.menuRow, index === OVERVIEW.length - 1 && styles.menuRowLast]}
              onPress={() => (row.page ? props.onPage(row.page) : row.action === 'filters' ? props.onFilters() : props.onBackup())}
            >
              <View style={styles.menuTexts}>
                <Text style={styles.menuTitle}>{t(row.title)}</Text>
                <Text style={styles.menuSummary}>{t(row.summary)}</Text>
              </View>
              <Text style={styles.menuChevron}>›</Text>
            </Pressable>
          ))}
        </View>
      ) : (
        pages[page]
      )}
    </FormScroll>
  )
}
