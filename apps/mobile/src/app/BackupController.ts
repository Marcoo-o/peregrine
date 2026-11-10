import { restoreBackup, makeBackup, openBackup, type BackupCounts, type BackupOptions } from '../backup'
import { explainError } from '../errors'
import { t, tn } from '../i18n'
import type { Services } from './services'
import type { AppStore } from './store'

/** The largest file that is read as a backup: a few thousand rules, tasks and contacts are some hundred kilobytes, and more is not a backup of this. */
const MAX_FILE_BYTES = 50 * 1024 * 1024

/** The shortest password for a backup. The file is what holds the keys, and a short password is what anybody who gets the file tries first. */
export const MIN_PASSWORD = 8

/** What a count says in words, leaving out what is nought. */
export function countsText(counts: BackupCounts): string {
  const parts = [
    counts.accounts > 0 ? tn(counts.accounts, '{count} Konto', '{count} Konten') : '',
    counts.identities > 0 ? tn(counts.identities, '{count} Absender', '{count} Absender') : '',
    counts.keys > 0 ? tn(counts.keys, '{count} Schlüssel', '{count} Schlüssel') : '',
    counts.contacts > 0 ? tn(counts.contacts, '{count} Kontakt', '{count} Kontakte') : '',
    counts.tags > 0 ? tn(counts.tags, '{count} Tag', '{count} Tags') : '',
    counts.rules > 0 ? tn(counts.rules, '{count} Regel', '{count} Regeln') : '',
    counts.tasks > 0 ? tn(counts.tasks, '{count} Aufgabe', '{count} Aufgaben') : '',
    counts.settings > 0 ? tn(counts.settings, '{count} Einstellung', '{count} Einstellungen') : ''
  ].filter((part) => part !== '')
  return parts.length > 0 ? parts.join(', ') : t('nichts')
}

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
  show(notice?: string, error?: string, busy?: string): void {
    this.store.showScreen({ name: 'backup', notice, error, busy })
  }

  /** Makes a backup sealed with the password, and lets the user choose where to save it. */
  async make(password: string, again: string, options: BackupOptions): Promise<void> {
    if (password.length < MIN_PASSWORD) return this.show(undefined, t('Das Passwort braucht mindestens {n} Zeichen.', { n: MIN_PASSWORD }))
    if (password !== again) return this.show(undefined, t('Die beiden Passwörter sind nicht gleich.'))
    this.show(undefined, undefined, t('Die Sicherung wird verschlüsselt. Das dauert einen Moment.'))
    try {
      const { file, counts } = await makeBackup(this.services.db, this.services.backupCipher, password, options)
      const name = backupFileName(new Date())
      const saved = await this.services.files.save(name, 'application/octet-stream', file)
      if (!saved) return this.show()
      this.show(t('Gespeichert: {name}. Darin: {counts}.', { name, counts: countsText(counts) }))
    } catch (error) {
      this.show(undefined, t('Die Sicherung ging schief: {n}', { n: explainError(error) }))
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
      this.show(undefined, undefined, t('Die Sicherung wird geöffnet. Das dauert einen Moment.'))
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
      this.show(lines.join(' '))
    } catch (error) {
      this.show(undefined, t('Das Zurückspielen ging schief: {n}', { n: explainError(error) }))
    }
  }
}
