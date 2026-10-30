import { encodeUtf8 } from '@peregrine/imap/utf8'
import { listAccounts } from '../accounts'
import { attachmentContent, type AttachmentInfo } from '../attachments'
import { explainError } from '../errors'
import type { ProtectionDefaults } from '../pgp/protectionDefaults'
import { listContactKeys, listOwnKeys, removeContactKey, removeOwnKey, saveContactKey, saveOwnKey } from '../pgp/keyStore'
import { keyFileName } from '../pgp/keyText'
import { KeyLookupError, lookupKey, type KeySource } from '../pgp/keyLookup'
import { PublishError, publishKey, type Poster } from '../pgp/keyPublish'
import { generateKeyPair, keyState, scanKeys, unlockKey } from '../pgp/pgpService'
import type { KeysState } from './screens'
import type { Services } from './services'
import type { AppStore } from './store'

/** Letting the screen draw what is being said before a long piece of work holds the thread that draws. */
const letScreenDraw = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 50))

/** Opening a key that is sealed is the long piece of work, and the user is told so before it begins. */
const OPENING = 'Der Schlüssel wird geöffnet. Das dauert einige Sekunden.'

/** Where a key was found, in the words of its card. */
function foundByText(source: KeySource, address: string): string {
  const domain = address.slice(address.lastIndexOf('@') + 1).trim().toLowerCase()
  return source === 'WKD' ? `Gefunden im Verzeichnis von ${domain} (WKD)` : 'Gefunden auf keys.openpgp.org'
}

/**
 * The OpenPGP keys: the account's own, which are made here or read from a file, and the public keys of the people the
 * user writes to, which are read from a file or from text that was pasted. Signing and encrypting find them in the
 * database; this is where they are put there and taken away.
 */
export class KeysController {
  constructor(
    private readonly services: Services,
    private readonly store: AppStore,
    private readonly protection: ProtectionDefaults
  ) {}

  /** Shows the keys, with a line about what was just done when there is one, and what was found in a file and waits to be placed. */
  async show(patch: Pick<KeysState, 'notice' | 'error' | 'found'> = {}): Promise<void> {
    const { db } = this.services
    const accounts = await listAccounts(db)
    const own: KeysState['own'] = {}
    for (const account of accounts) own[account.id] = await listOwnKeys(db, account.id)
    await this.protection.load()
    const contacts = await listContactKeys(db)
    const states: KeysState['states'] = {}
    for (const key of [...Object.values(own).flat(), ...contacts]) states[key.fingerprint] = await keyState(key.publicKey)
    this.store.showScreen({ name: 'keys', accounts, own, contacts, states, defaults: { ...this.protection.settings }, ...patch })
  }

  /** The state of the keys screen when it is the screen, or undefined. */
  private current(): KeysState | undefined {
    const shown = this.store.screen
    return shown.name === 'keys' ? shown : undefined
  }

  /** What was found and has not been placed yet, which stays on the screen while other things are done. */
  private found(): KeysState['found'] {
    return this.current()?.found
  }

  /** What was found, without the key that was dealt with; nothing at all when that was the last. */
  private foundWithout(fingerprint: string): KeysState['found'] {
    const rest = this.found()?.filter((candidate) => candidate.fingerprint !== fingerprint)
    return rest && rest.length > 0 ? rest : undefined
  }

  private async working(text: string): Promise<void> {
    const shown = this.current()
    if (shown) this.store.showScreen({ ...shown, working: text, notice: undefined, error: undefined })
    await letScreenDraw()
  }

  /** Sets whether every new message starts signed or encrypted. It is for the accounts that have a key; the others are as they were. */
  async setDefault(which: 'sign' | 'encrypt', on: boolean): Promise<void> {
    await this.protection.change({ [which]: on })
    await this.show({ found: this.found() })
  }

  /** How a key is looked up. It is a field so that it can be another in a test, which has no internet. */
  lookup: typeof lookupKey = lookupKey

  /**
   * Looks for the public key of an address where it is published, and shows what is found to be placed like a key from a file.
   * Only when the user asks, for the address they typed: asking tells the servers whom the user is about to write to.
   */
  async search(address: string): Promise<void> {
    await this.working('Es wird nach dem Schlüssel gesucht …')
    try {
      const found = await this.lookup(address.trim())
      const foundBy = foundByText(found.source, address)
      await this.show({ found: found.keys.map((key) => ({ ...key, foundBy })) })
    } catch (error) {
      const failure = error instanceof KeyLookupError ? error.failure : undefined
      const text =
        failure === 'notAnAddress'
          ? 'Das ist keine E-Mail-Adresse.'
          : failure === 'notFound'
            ? `Für ${address.trim()} ist kein Schlüssel veröffentlicht. Gefragt wurden der Mailserver der Adresse (WKD) und keys.openpgp.org.`
            : failure === 'unreachable'
              ? 'Die Server ließen sich nicht erreichen. Gibt es eine Internetverbindung?'
              : `Die Suche ging schief: ${explainError(error)}`
      await this.show({ error: text, found: this.found() })
    }
  }

  /** The key of the sender of a message, looked for where it is published, and shown to be placed: from the message it is a tap and not the typing of an address. */
  async findFor(address: string): Promise<void> {
    await this.show()
    await this.search(address)
  }

  /** How a key is published. A field for the same reason as `lookup`. */
  poster: Poster = (url, init) => (fetch as unknown as (url: string, init: unknown) => ReturnType<Poster>)(url, init)

  /**
   * Publishes the public key of an account on keys.openpgp.org, and asks the server to send the mail that confirms the address. It is said what this
   * does and what it does not: the key is public from then on, and is found by the address once the link in the mail has been followed.
   */
  async publish(accountId: string, fingerprint: string): Promise<void> {
    const key = (await listOwnKeys(this.services.db, accountId)).find((candidate) => candidate.fingerprint === fingerprint)
    const account = (await listAccounts(this.services.db)).find((candidate) => candidate.id === accountId)
    if (!key || !account?.emailAddress) return
    await this.working('Der Schlüssel wird veröffentlicht …')
    try {
      const published = await publishKey(key.publicKey, account.emailAddress, this.poster)
      const notice = published.confirmed
        ? `Der Schlüssel ist veröffentlicht, und ${account.emailAddress} ist bestätigt: wer danach sucht, findet ihn.`
        : `Der Schlüssel ist hochgeladen. keys.openpgp.org hat eine Mail an ${account.emailAddress} geschickt: erst wenn du den Link darin öffnest, findet man den Schlüssel über die Adresse.`
      await this.show({ notice, found: this.found() })
    } catch (error) {
      const text =
        error instanceof PublishError
          ? error.failure === 'unreachable'
            ? 'Der Server ließ sich nicht erreichen. Gibt es eine Internetverbindung?'
            : `Der Server hat den Schlüssel nicht genommen: ${error.detail ?? 'ohne Grund'}`
          : `Das Veröffentlichen ging schief: ${explainError(error)}`
      await this.show({ error: text, found: this.found() })
    }
  }

  /** Makes a key pair for an account on the phone. */
  async generate(accountId: string): Promise<void> {
    const account = (await listAccounts(this.services.db)).find((candidate) => candidate.id === accountId)
    if (!account?.emailAddress) {
      await this.show({ error: 'Zu diesem Konto gibt es keine Absenderadresse, für die ein Schlüssel gemacht werden könnte.', found: this.found() })
      return
    }
    await this.working('Der Schlüssel wird erzeugt …')
    try {
      const pair = await generateKeyPair(account.displayName || account.emailAddress, account.emailAddress)
      await saveOwnKey(this.services.db, {
        fingerprint: pair.fingerprint,
        accountId,
        publicKey: pair.publicKey,
        privateKey: pair.privateKey,
        createdAt: Date.now()
      })
      await this.show({ notice: `Ein Schlüssel für ${account.emailAddress} ist angelegt. Gib den öffentlichen Teil an alle, die dir verschlüsselt schreiben sollen.`, found: this.found() })
    } catch (error) {
      await this.show({ error: `Der Schlüssel konnte nicht erzeugt werden: ${explainError(error)}`, found: this.found() })
    }
  }

  /**
   * Takes the keys that an attachment of the open message holds, which are shown to be placed as for any file: nothing is
   * stored before the user says where it belongs.
   */
  async takeFrom(source: Uint8Array | undefined, attachment: AttachmentInfo): Promise<void> {
    const content = source ? attachmentContent(source, attachment.id) : undefined
    await this.show()
    if (!content) {
      await this.show({ error: `${attachment.filename} ließ sich in der Nachricht nicht lesen.` })
      return
    }
    await this.scan(content)
  }

  /** Lets the user pick a file with keys and reads it. */
  async pickFile(): Promise<void> {
    const { files } = this.services
    try {
      const [picked] = await files.pick()
      if (!picked) return
      try {
        await this.scan(await files.read(picked.path))
      } finally {
        await files.remove([picked.path]).catch(() => undefined)
      }
    } catch (error) {
      await this.show({ error: `Die Datei ließ sich nicht lesen: ${explainError(error)}`, found: this.found() })
    }
  }

  /** Reads the keys in a file or in text that was pasted, and shows them to be placed. Nothing is stored yet. */
  async scan(material: string | Uint8Array): Promise<void> {
    try {
      const found = await scanKeys(material)
      await this.show(
        found.length === 0 ? { error: 'Darin steht kein Schlüssel.' } : { found, notice: undefined }
      )
    } catch (error) {
      await this.show({ error: `Das ist kein Schlüssel, den das Handy lesen kann. (${explainError(error)})`, found: this.found() })
    }
  }

  /** Takes a private key that was read for an account, opening it first when it is sealed. */
  async adoptOwn(fingerprint: string, accountId: string, passphrase: string): Promise<void> {
    const key = this.found()?.find((candidate) => candidate.fingerprint === fingerprint)
    if (!key?.privateKey) return
    if (key.locked) await this.working(OPENING)
    try {
      const opened = await unlockKey(key.privateKey, passphrase)
      if (!opened.ok) {
        await this.show({
          error: opened.reason === 'wrongPassphrase' ? 'Das Passwort stimmt nicht.' : 'Der Schlüssel ist mit einem Passwort geschützt. Gib es ein.',
          found: this.found()
        })
        return
      }
      await saveOwnKey(this.services.db, { fingerprint, accountId, publicKey: key.publicKey, privateKey: opened.privateKey, createdAt: Date.now() })
      await this.show({ notice: 'Der Schlüssel ist übernommen.', found: this.foundWithout(fingerprint) })
    } catch (error) {
      await this.show({ error: `Der Schlüssel ließ sich nicht öffnen: ${explainError(error)}`, found: this.found() })
    }
  }

  /** Takes a public key that was read, for an address. */
  async adoptContact(fingerprint: string, address: string): Promise<void> {
    const key = this.found()?.find((candidate) => candidate.fingerprint === fingerprint)
    if (!key) return
    await saveContactKey(this.services.db, { fingerprint, address, publicKey: key.publicKey, createdAt: Date.now() })
    await this.show({ notice: `Der Schlüssel für ${address} ist gemerkt.`, found: this.foundWithout(fingerprint) })
  }

  /** Leaves a key that was found where it is: it is not taken. */
  async dismiss(fingerprint: string): Promise<void> {
    await this.show({ found: this.foundWithout(fingerprint) })
  }

  async removeOwn(accountId: string, fingerprint: string): Promise<void> {
    await removeOwnKey(this.services.db, accountId, fingerprint)
    await this.show({ notice: 'Der Schlüssel ist entfernt. Was damit verschlüsselt wurde, lässt sich auf diesem Handy nicht mehr öffnen.', found: this.found() })
  }

  async removeContact(fingerprint: string): Promise<void> {
    await removeContactKey(this.services.db, fingerprint)
    await this.show({ notice: 'Der Schlüssel ist entfernt.', found: this.found() })
  }

  /** Lets the user save the public half of an own key as a file, to give it to others. */
  async exportPublic(accountId: string, fingerprint: string): Promise<void> {
    const key = (await listOwnKeys(this.services.db, accountId)).find((candidate) => candidate.fingerprint === fingerprint)
    const account = (await listAccounts(this.services.db)).find((candidate) => candidate.id === accountId)
    if (!key) return
    try {
      const saved = await this.services.files.save(keyFileName(account?.emailAddress ?? ''), 'application/pgp-keys', encodeUtf8(key.publicKey))
      await this.show(saved ? { notice: 'Der öffentliche Schlüssel ist gespeichert.', found: this.found() } : { found: this.found() })
    } catch (error) {
      await this.show({ error: `Der Schlüssel ließ sich nicht speichern: ${explainError(error)}`, found: this.found() })
    }
  }
}
