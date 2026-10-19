import { errorText } from '@renderer/util/errorText'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BookUser, ClipboardPaste, Download, Globe, KeyRound, Plus, Trash2, Upload } from 'lucide-react'
import type { Contact, ContactKeyInfo } from '@peregrine/core/types'
import { askForText } from '@renderer/state/promptStore'
import { toastError } from '@renderer/state/toastStore'

function ContactsSection(): JSX.Element {
  const { t } = useTranslation()
  const [contacts, setContacts] = useState<Contact[]>([])
  const [keyFingerprints, setKeyFingerprints] = useState<Record<string, string>>({})
  /** Where each key came from. A fingerprint alone says nothing about what it is worth. */
  const [keyInfos, setKeyInfos] = useState<Record<string, ContactKeyInfo>>({})
  /** How many keys each contact holds; more than one means older ones are kept. */
  const [ringSizes, setRingSizes] = useState<Record<string, number>>({})
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [busyContactId, setBusyContactId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function reload(): Promise<void> {
    const [contactList, fingerprints, keys] = await Promise.all([
      window.peregrine.contacts.list(),
      window.peregrine.pgp.contactKeyFingerprints(),
      window.peregrine.pgp.listContactKeys()
    ])
    setContacts(contactList)
    setKeyFingerprints(fingerprints)
    setKeyInfos(Object.fromEntries(keys.map((key) => [key.contactId, key])))

    // Only asked for where there is a key at all. A contact without one has no ring.
    const rings = await Promise.all(
      keys.map(async (key) => {
        const ring = await window.peregrine.pgp.contactKeyRing({ contactId: key.contactId })
        return [key.contactId, ring.length] as const
      })
    )
    setRingSizes(Object.fromEntries(rings))
  }

  useEffect(() => {
    void reload()
  }, [])

  async function handleAdd(): Promise<void> {
    if (!email.trim()) return
    await window.peregrine.contacts.create(name.trim(), email.trim())
    setName('')
    setEmail('')
    await reload()
  }

  async function handleDelete(contactId: string): Promise<void> {
    await window.peregrine.contacts.delete(contactId)
    await reload()
  }

  async function handlePastePgpKey(contactId: string): Promise<void> {
    const armored = await askForText({
      title: t('settings.pastePgpKey'),
      multiline: true,
      placeholder: '-----BEGIN PGP PUBLIC KEY BLOCK-----'
    })
    if (!armored) return
    try {
      await window.peregrine.pgp.setContactPublicKey({ contactId, publicKeyArmored: armored })
      await reload()
    } catch (err) {
      toastError(err, t('settings.pastePgpKey'))
    }
  }

  async function handleDiscoverKey(contact: Contact): Promise<void> {
    setBusyContactId(contact.id)
    setNotice(null)
    try {
      // The same lookup the reading pane uses, so a key gets the same recorded origin no
      // matter where it was fetched from.
      const result = await window.peregrine.pgp.discoverForAddress({
        email: contact.email,
        name: contact.name
      })
      setNotice(
        result.found && result.key
          ? t('settings.pgpKeyFound', { source: t(`pgpKey.sourceShort.${result.key.source}`) })
          : t('settings.pgpKeyNotFound')
      )
      if (result.found) await reload()
    } catch (err) {
      setNotice(errorText(err))
    } finally {
      setBusyContactId(null)
    }
  }

  async function handleRemoveKey(contactId: string): Promise<void> {
    await window.peregrine.pgp.deleteContactKey(contactId)
    await reload()
  }

  async function handleImport(): Promise<void> {
    try {
      const result = await window.peregrine.contacts.importVCard()
      // Null means the file dialog was dismissed, which is not worth a message.
      if (!result) return
      setNotice(t('settings.vcardImported', result))
      await reload()
    } catch (err) {
      toastError(err, t('settings.importVCard'))
    }
  }

  async function handleImportThunderbird(): Promise<void> {
    try {
      const result = await window.peregrine.contacts.importThunderbird()
      setNotice(result ? t('settings.vcardImported', result) : t('settings.thunderbirdNoProfile'))
      if (result) await reload()
    } catch (err) {
      toastError(err, t('settings.importThunderbirdContacts'))
    }
  }

  async function handleExport(): Promise<void> {
    try {
      const result = await window.peregrine.contacts.exportVCard()
      if (!result) return
      setNotice(t('settings.vcardExported', { count: result.count, path: result.savedPath }))
    } catch (err) {
      toastError(err, t('settings.exportVCard'))
    }
  }

  return (
    <section className="settings-section">
      <h3>{t('settings.contacts')}</h3>

      {/* Above the list rather than below it: an address book that has filled itself in over
          a year is hundreds of rows long, and a button under all of them is a button nobody
          finds. */}
      <div className="settings-header-actions">
        <button onClick={() => void handleImport()}>
          <Upload size={15} strokeWidth={1.75} />
          {t('settings.importVCard')}
        </button>
        <button onClick={() => void handleExport()} disabled={contacts.length === 0}>
          <Download size={15} strokeWidth={1.75} />
          {t('settings.exportVCard')}
        </button>
        <button onClick={() => void handleImportThunderbird()}>
          <BookUser size={15} strokeWidth={1.75} />
          {t('settings.importThunderbirdContacts')}
        </button>
      </div>
      <p className="settings-hint">{t('settings.vcardHint')}</p>
      {notice && <p className="pgp-notice">{notice}</p>}

      <ul className="settings-account-list">
        {contacts.map((contact) => {
          const fingerprint = keyFingerprints[contact.id]
          return (
            <li key={contact.id} className="settings-account-row">
              <div className="settings-account-info">
                <span className="settings-account-name">
                  {contact.name || contact.email}
                  {fingerprint && <KeyRound size={12} strokeWidth={2} className="contact-key-icon" />}
                </span>
                <span className="settings-account-email">
                  {fingerprint ? `${contact.email} · ${fingerprint.slice(-16)}` : contact.email}
                </span>
                {keyInfos[contact.id] && (
                  <span className="contact-key-origin">
                    {t(`pgpKey.source.${keyInfos[contact.id].source}`)}
                    {keyInfos[contact.id].updatedAt ? ` · ${keyInfos[contact.id].updatedAt}` : ''}
                  </span>
                )}
                {/* Retired keys are not clutter: a signature can only be checked against the
                    key that made it, so an older one keeps old mail verifiable. */}
                {(ringSizes[contact.id] ?? 0) > 1 && (
                  <span className="contact-key-origin" title={t('settings.pgpContactRingHint')}>
                    {t('settings.pgpContactRing', { count: ringSizes[contact.id] - 1 })}
                  </span>
                )}
              </div>
              {fingerprint ? (
                <button
                  onClick={() => void handleRemoveKey(contact.id)}
                  aria-label={t('settings.pgpRemoveContactKey')}
                  title={t('settings.pgpRemoveContactKey')}
                >
                  <KeyRound size={15} strokeWidth={1.75} />
                </button>
              ) : (
                <>
                  <button
                    onClick={() => void handleDiscoverKey(contact)}
                    disabled={busyContactId === contact.id}
                    aria-label={t('settings.pgpLookupKey')}
                    title={t('settings.pgpLookupKey')}
                  >
                    <Globe size={15} strokeWidth={1.75} />
                  </button>
                  <button
                    onClick={() => void handlePastePgpKey(contact.id)}
                    aria-label={t('settings.pastePgpKey')}
                    title={t('settings.pastePgpKey')}
                  >
                    <ClipboardPaste size={15} strokeWidth={1.75} />
                  </button>
                </>
              )}
              <button onClick={() => void handleDelete(contact.id)} aria-label={t('settings.deleteContact')}>
                <Trash2 size={15} strokeWidth={1.75} />
              </button>
            </li>
          )
        })}
      </ul>

      <div className="filter-rule-form">
        <input placeholder={t('settings.contactName')} value={name} onChange={(e) => setName(e.target.value)} />
        <input
          placeholder={t('settings.contactEmail')}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <button onClick={handleAdd} disabled={!email.trim()}>
          <Plus size={15} strokeWidth={1.75} />
          {t('settings.addContact')}
        </button>
      </div>
    </section>
  )
}

export default ContactsSection
