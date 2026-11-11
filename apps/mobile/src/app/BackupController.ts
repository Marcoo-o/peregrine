import { applyAutoBackup, loadAutoBackup, saveAutoBackup, type AutoBackupSettings } from '../autoBackup'
import { countsText, restoreBackup, makeBackup, openBackup, type BackupOptions } from '../backup'
import { explainError } from '../errors'
import { t, tn } from '../i18n'
import type { Services } from './services'
import type { AppStore } from './store'

/** The largest file that is read as a backup: a few thousand rules, tasks and contacts are some hundred kilobytes, and more is not a backup of this. */
const MAX_FILE_BYTES = 50 * 1024 * 1024

/** The shortest password for a backup. The file is what holds the keys, and a short password is what anybody who gets the file tries first. */
export const MIN_PASSWORD = 8

/** The name of the file of a backup made on a day. */
export function backupFileName(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `peregrine-backup-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}.pgbk`
}

/** Making a backup of what the user made, and putting one back. */
export class BackupController {
  constructor(
    private readonly services: Services,
    private readonly store: AppStore,
    /** What has to be read again from the database once a backup was put back: the tags, the identities, the settings that are held in memory. */
    private readonly restored: () => Promise<void>
  ) {}

  /** The screen, with a line about what was just done or what went wrong. */
  async show(notice?: string, error?: string, busy?: string): Promise<void> {
    const { db, backupFolder } = this.services
    const state = await backupFolder.state().catch(() => ({ folder: null, hasPassword: false }))
    this.store.showScreen({ name: 'backup', auto: { settings: await loadAutoBackup(db), folder: state.folder, hasPassword: state.hasPassword }, notice, error, busy })
  }

  /** Puts a change of the scheduled backup in force: kept, and the next run armed or cancelled. It cannot be switched on without a folder and a password. */
  async setAuto(change: Partial<AutoBackupSettings>): Promise<void> {
    const { db, backupFolder } = this.services
    if (change.enabled === true) {
      const state = await backupFolder.state()
      if (!state.folder || !state.hasPassword) return this.show(undefined, t('Wähle zuerst einen Ordner und gib ein Passwort ein.'))
    }
    await saveAutoBackup(db, change)
    await applyAutoBackup(db, backupFolder)
    await this.show()
  }

  /** Lets the user choose the folder the scheduled backups go into. */
  async chooseFolder(): Promise<void> {
    const { db, backupFolder } = this.services
    try {
      const name = await backupFolder.chooseFolder()
      if (name === null) return this.show()
      await applyAutoBackup(db, backupFolder)
      await this.show(t('Die Sicherungen gehen in den Ordner „{name}“.', { name }))
    } catch (error) {
      await this.show(undefined, t('Der Ordner ließ sich nicht wählen: {n}', { n: explainError(error) }))
    }
  }

  /** Keeps the password of the scheduled backups, sealed by the Keystore. It is not shown again and not given back. */
  async rememberPassword(password: string): Promise<void> {
    const { db, backupFolder } = this.services
    if (password.length < MIN_PASSWORD) return this.show(undefined, t('Das Passwort braucht mindestens {n} Zeichen.', { n: MIN_PASSWORD }))
    try {
      await backupFolder.rememberPassword(password)
      await applyAutoBackup(db, backupFolder)
      await this.show(t('Das Passwort ist gemerkt, vom Schlüsselspeicher des Telefons gesichert.'))
    } catch (error) {
      await this.show(undefined, t('Das Passwort ließ sich nicht merken: {n}', { n: explainError(error) }))
    }
  }

  /** Forgets the password and with it the schedule: a scheduled backup cannot be made without it. */
  async forgetPassword(): Promise<void> {
    const { db, backupFolder } = this.services
    await backupFolder.forgetPassword()
    await saveAutoBackup(db, { enabled: false })
    await applyAutoBackup(db, backupFolder)
    await this.show(t('Das Passwort ist vergessen und das automatische Sichern aus.'))
  }

  /** Makes a scheduled backup now, in the background where the schedule makes them. */
  async runAutoNow(): Promise<void> {
    await this.services.backupFolder.runNow()
    await this.show(t('Die Sicherung läuft im Hintergrund. Das Ergebnis steht gleich hier.'))
  }

  /** Makes a backup sealed with the password, and lets the user choose where to save it. */
  async make(password: string, again: string, options: BackupOptions): Promise<void> {
    if (password.length < MIN_PASSWORD) return this.show(undefined, t('Das Passwort braucht mindestens {n} Zeichen.', { n: MIN_PASSWORD }))
    if (password !== again) return this.show(undefined, t('Die beiden Passwörter sind nicht gleich.'))
    await this.show(undefined, undefined, t('Die Sicherung wird verschlüsselt. Das dauert einen Moment.'))
    try {
      const { file, counts } = await makeBackup(this.services.db, this.services.backupCipher, password, options)
      const name = backupFileName(new Date())
      const saved = await this.services.files.save(name, 'application/octet-stream', file)
      if (!saved) return this.show()
      await this.show(t('Gespeichert: {name}. Darin: {counts}.', { name, counts: countsText(counts) }))
    } catch (error) {
      await this.show(undefined, t('Die Sicherung ging schief: {n}', { n: explainError(error) }))
    }
  }

  /** Lets the user pick a backup, opens it with the password and adds what is in it to what the phone has. */
  async restore(password: string): Promise<void> {
    const { files, db } = this.services
    if (password === '') return this.show(undefined, t('Gib das Passwort der Sicherung ein.'))
    try {
      const [picked] = await files.pick()
      if (!picked) return
      if (picked.size > MAX_FILE_BYTES) {
        await files.remove([picked.path]).catch(() => undefined)
        return this.show(undefined, t('Die Datei ist zu groß für eine Sicherung.'))
      }
      const file = await files.read(picked.path)
      await files.remove([picked.path]).catch(() => undefined)
      await this.show(undefined, undefined, t('Die Sicherung wird geöffnet. Das dauert einen Moment.'))
      const opened = await openBackup(this.services.backupCipher, file, password)
      if ('problem' in opened) {
        const said =
          opened.problem === 'password'
            ? t('Das Passwort stimmt nicht, oder die Datei ist keine Sicherung von Peregrine.')
            : opened.problem === 'newer'
              ? t('Diese Sicherung ist von einer neueren Version von Peregrine.')
              : t('Die Datei ist keine Sicherung von Peregrine.')
        return this.show(undefined, said)
      }
      const result = await restoreBackup(db, opened.bundle)
      await this.restored()
      const lines = [t('Zurückgespielt: {added}. Schon da: {known}.', { added: countsText(result.added), known: countsText(result.known) })]
      if (result.accountsWithoutPassword > 0) lines.push(tn(result.accountsWithoutPassword, '{count} Konto braucht noch sein Passwort: unter „Konto bearbeiten“.', '{count} Konten brauchen noch ihr Passwort: unter „Konto bearbeiten“.'))
      if (result.rulesWithoutFolder > 0) lines.push(tn(result.rulesWithoutFolder, '{count} Regel wartet auf ihren Ordner: spiel die Sicherung noch einmal zurück, wenn das Konto verbunden ist.', '{count} Regeln warten auf ihren Ordner: spiel die Sicherung noch einmal zurück, wenn das Konto verbunden ist.'))
      await this.show(lines.join(' '))
    } catch (error) {
      await this.show(undefined, t('Das Zurückspielen ging schief: {n}', { n: explainError(error) }))
    }
  }
}
