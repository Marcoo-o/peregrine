import { decodeUtf8, encodeUtf8 } from '@peregrine/imap/utf8'
import { parseAddress } from '@peregrine/smtp/headers'
import { explainError } from '../errors'
import { importVcards, listBook, removeContact, saveContact, toVcards } from '../contactBook'
import type { Services } from './services'
import type { AppStore } from './store'
import { t } from '../i18n'

/** The largest vCard file that is read: a few thousand contacts are some hundred kilobytes, and more is not an address book of a person. */
const MAX_FILE_BYTES = 5 * 1024 * 1024

/** The contacts the user keeps: seen, added, changed, taken away, and taken in from and written to a vCard file. */
export class ContactsController {
  constructor(
    private readonly services: Services,
    private readonly store: AppStore
  ) {}

  /** The contacts, with a line about what was just done or what went wrong. */
  async show(notice?: string, error?: string): Promise<void> {
    this.store.showScreen({ name: 'contacts', contacts: await listBook(this.services.db), notice, error })
  }

  /** Keeps a contact: a new one when `id` is null, and else the change of that one. */
  async save(id: string | null, fields: { name: string; address: string }): Promise<void> {
    const result = await saveContact(this.services.db, fields, id ?? undefined)
    if ('problem' in result) await this.show(undefined, result.problem)
    else await this.show(t('Gespeichert.'))
  }

  async remove(id: string): Promise<void> {
    await removeContact(this.services.db, id)
    await this.show(t('Der Kontakt ist entfernt.'))
  }

  /**
   * Keeps the sender of a message as a contact, from the line the message has for it, and says on the message that it did. The one that is kept
   * already is not kept twice.
   */
  async addSender(sender: string): Promise<string> {
    const { name, address } = parseAddress(sender)
    const result = await saveContact(this.services.db, { name: name ?? '', address })
    return 'problem' in result ? result.problem : t('{n} ist bei den Kontakten.', { n: result.saved.name || result.saved.address })
  }

  /** Lets the user pick a vCard file, and takes its cards in. Says how many came and how many were there already. */
  async importFile(): Promise<void> {
    const { files, db } = this.services
    try {
      const [picked] = await files.pick()
      if (!picked) return
      if (picked.size > MAX_FILE_BYTES) {
        await files.remove([picked.path]).catch(() => undefined)
        await this.show(undefined, t('Die Datei ist zu groß für eine Kontaktdatei.'))
        return
      }
      const text = decodeUtf8(await files.read(picked.path))
      await files.remove([picked.path]).catch(() => undefined)
      const { added, known, skipped } = await importVcards(db, text)
      if (added + known + skipped === 0) {
        await this.show(undefined, t('In der Datei steht keine Visitenkarte.'))
        return
      }
      const parts = [t('{added} neu', { added }), known > 0 ? t('{known} schon da', { known }) : null, skipped > 0 ? t('{skipped} ohne gültige Adresse ausgelassen', { skipped }) : null].filter(Boolean)
      await this.show(t('Übernommen: {n}.', { n: parts.join(', ') }))
    } catch (error) {
      await this.show(undefined, t('Die Datei ließ sich nicht lesen: {n}', { n: explainError(error) }))
    }
  }

  /** Writes all the contacts, or one, to a vCard file where the user chooses. */
  async exportFile(id?: string): Promise<void> {
    const all = await listBook(this.services.db)
    const chosen = id === undefined ? all : all.filter((contact) => contact.id === id)
    if (chosen.length === 0) {
      await this.show(undefined, t('Es gibt keine Kontakte, die sich speichern ließen.'))
      return
    }
    try {
      const name = id === undefined ? 'kontakte.vcf' : `${(chosen[0].name || chosen[0].address).replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').trim()}.vcf`
      const saved = await this.services.files.save(name, 'text/vcard', encodeUtf8(toVcards(chosen)))
      await this.show(saved ? t('Gespeichert: {name}', { name }) : undefined)
    } catch (error) {
      await this.show(undefined, t('Speichern ging nicht: {n}', { n: explainError(error) }))
    }
  }
}
