import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { KeyRound, Search } from 'lucide-react'
import type { ContactKeyInfo } from '@peregrine/core/types'
import { toastError, toastInfo } from '@renderer/state/toastStore'

interface SenderKeyRowProps {
  accountId: string
  senderAddress: string
  senderName: string
  /** Shown unprompted for signed mail; otherwise only once a key is actually known. */
  signed: boolean
  /** A key was stored, so the signature can be checked again. */
  onKeyStored: () => void
}

/** `AABB CCDD …`. The grouping is what makes a fingerprint comparable by eye over a phone. */
function groupFingerprint(fingerprint: string): string {
  return (fingerprint.match(/.{1,4}/g) ?? [fingerprint]).join(' ').toUpperCase()
}

/**
 * What is known about the sender's public key, where the sender is.
 *
 * A signed message whose key is missing used to say only "sender key missing". And the way
 * to change that was to leave the mail, open the settings, find the contact and look there.
 * The moment one wants the key is the moment the message is on screen.
 */
function SenderKeyRow({
  accountId,
  senderAddress,
  senderName,
  signed,
  onKeyStored
}: SenderKeyRowProps): JSX.Element | null {
  const { t } = useTranslation()
  const [key, setKey] = useState<ContactKeyInfo | null>(null)
  const [searching, setSearching] = useState(false)
  const [searched, setSearched] = useState(false)

  useEffect(() => {
    setKey(null)
    setSearched(false)
    if (!senderAddress) return
    let cancelled = false
    void window.peregrine.pgp
      .contactKeyForAddress({ email: senderAddress })
      .then((info) => {
        if (!cancelled) setKey(info)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [senderAddress])

  async function search(): Promise<void> {
    setSearching(true)
    try {
      const result = await window.peregrine.pgp.discoverForAddress({
        email: senderAddress,
        name: senderName,
        accountId
      })
      setSearched(true)
      if (result.found && result.key) {
        setKey(result.key)
        toastInfo(t('pgpKey.found', { source: t(`pgpKey.source.${result.key.source}`) }))
        // The signature verdict above was reached without this key. Reading the message
        // again is what turns "sender key missing" into an answer.
        onKeyStored()
      } else {
        toastInfo(t('pgpKey.notFound'))
      }
    } catch (err) {
      toastError(err, t('pgpKey.searchFailed'))
    } finally {
      setSearching(false)
    }
  }

  // Nothing to say about ordinary mail from someone with no key: the row would appear on
  // every message and mean nothing.
  if (!key && !signed) return null

  return (
    <p className="sender-key-row">
      <KeyRound size={13} strokeWidth={1.75} />
      {key ? (
        <>
          <span className="sender-key-source">{t(`pgpKey.source.${key.source}`)}</span>
          <code className="sender-key-fingerprint" title={groupFingerprint(key.fingerprint)}>
            {groupFingerprint(key.fingerprint)}
          </code>
        </>
      ) : (
        <>
          <span>{t('pgpKey.missing')}</span>
          <button className="sender-key-search" disabled={searching} onClick={() => void search()}>
            <Search size={12} strokeWidth={1.75} />
            {searching ? t('pgpKey.searching') : t('pgpKey.search')}
          </button>
          {searched && !searching && <span className="sender-key-none">{t('pgpKey.notFound')}</span>}
        </>
      )}
    </p>
  )
}

export default SenderKeyRow
