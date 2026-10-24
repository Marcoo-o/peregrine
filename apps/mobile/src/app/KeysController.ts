import { encodeUtf8 } from '@peregrine/imap/utf8'
import { listAccounts } from '../accounts'
import { explainError } from '../errors'
import { listContactKeys, listOwnKeys, removeContactKey, removeOwnKey, saveContactKey, saveOwnKey } from '../pgp/keyStore'
import { keyFileName } from '../pgp/keyText'
import { generateKeyPair, scanKeys, unlockKey } from '../pgp/pgpService'
import type { KeysState } from './screens'
import type { Services } from './services'
import type { AppStore } from './store'

/** Letting the screen draw what is being said before a long piece of work holds the thread that draws. */
const letScreenDraw = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 50))

/** Opening a key that is sealed is the long piece of work, and the user is told so before it begins. */
const OPENING = 'Der Schlüssel wird geöffnet. Das kann bis zu einer Minute dauern, die App reagiert in dieser Zeit nicht.'

/**
 * The OpenPGP keys: the account's own, which are made here or read from a file, and the public keys of the people the
 * user writes to, which are read from a file or from text that was pasted. Signing and encrypting find them in the
 * database; this is where they are put there and taken away.
 */
export class KeysController {
  constructor(
    private readonly services: Services,
    private readonly store: AppStore
  ) {}

  /** Shows the keys, with a line about what was just done when there is one, and what was found in a file and waits to be placed. */
  async show(patch: Pick<KeysState, 'notice' | 'error' | 'found'> = {}): Promise<void> {
    const { db } = this.services
    const accounts = await listAccounts(db)
    const own: KeysState['own'] = {}
    for (const account of accounts) own[account.id] = await listOwnKeys(db, account.id)
    this.store.showScreen({ name: 'keys', accounts, own, contacts: await listContactKeys(db), ...patch })
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
