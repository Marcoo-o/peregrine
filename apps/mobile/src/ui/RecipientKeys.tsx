import { useEffect, useMemo, useState } from 'react'
import { Text, View } from 'react-native'
import type { ScannedKey } from '../pgp/pgpService'
import { t } from '../i18n'
import { Button } from './controls'
import { useStyles } from './useStyles'

/** What a look for the key of one address has brought, or is still doing. */
type Look = { state: 'looking' } | { state: 'found'; keys: ScannedKey[] } | { state: 'failed'; error: string }

/**
 * Under the switch for encrypting: the recipients there is no public key for, each with a button to look for one where keys are published. What is found is
 * shown with its fingerprint and kept only when the user takes it, since a key that is found on the network is the network's word for whose it is.
 */
export function RecipientKeys(props: {
  addresses: string[]
  withoutKey: (addresses: string[]) => Promise<string[]>
  lookupKey: (address: string) => Promise<{ keys: ScannedKey[] } | { error: string }>
  adoptKey: (address: string, key: ScannedKey) => Promise<void>
}) {
  const styles = useStyles()
  const { addresses, withoutKey } = props
  const wanted = useMemo(() => addresses.join('\n'), [addresses])
  const [missing, setMissing] = useState<string[]>([])
  const [looks, setLooks] = useState<Record<string, Look>>({})
  const [version, setVersion] = useState(0)

  // Asked again when the recipients change and after a key was taken, and not for an address that is half typed.
  useEffect(() => {
    let current = true
    const complete = wanted.split('\n').filter((address) => /^\S+@\S+\.\S+$/.test(address))
    withoutKey(complete).then(
      (list) => current && setMissing(list),
      () => current && setMissing([])
    )
    return () => {
      current = false
    }
  }, [wanted, withoutKey, version])

  if (missing.length === 0) return null
  return (
    <View>
      {missing.map((address) => {
        const look = looks[address]
        return (
          <View key={address} style={styles.group}>
            <Text style={styles.hint}>{t('Für {n} ist kein Schlüssel hinterlegt.', { n: address })}</Text>
            {look?.state === 'failed' ? <Text style={styles.error}>{look.error}</Text> : null}
            {look?.state === 'found'
              ? look.keys.map((key) => (
                  <View key={key.fingerprint}>
                    <Text style={styles.itemMeta}>{key.foundBy}</Text>
                    <Text style={styles.itemMeta}>{key.userIds.join(', ')}</Text>
                    <Text style={styles.itemMeta}>{key.fingerprint}</Text>
                    <Button
                      label={t('Für {address} merken', { address })}
                      onPress={async () => {
                        await props.adoptKey(address, key)
                        setLooks((now) => ({ ...now, [address]: { state: 'found', keys: [] } }))
                        setVersion((now) => now + 1)
                      }}
                    />
                  </View>
                ))
              : null}
            <Button
              label={look?.state === 'looking' ? t('Es wird nach dem Schlüssel gesucht …') : t('Schlüssel suchen')}
              variant="secondary"
              disabled={look?.state === 'looking'}
              onPress={async () => {
                setLooks((now) => ({ ...now, [address]: { state: 'looking' } }))
                const result = await props.lookupKey(address)
                setLooks((now) => ({ ...now, [address]: 'keys' in result ? { state: 'found', keys: result.keys } : { state: 'failed', error: result.error } }))
              }}
            />
          </View>
        )
      })}
    </View>
  )
}
