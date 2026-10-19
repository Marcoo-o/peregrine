import { useState } from 'react'
import AccountScope from './AccountScope'
import KeyTransferSection from './KeyTransferSection'
import PgpSection from './PgpSection'

/**
 * The PGP settings area: taking keys over, then what each account uses.
 *
 * The two are joined by a counter rather than left independent, because importing a key is
 * precisely the moment the view below it goes stale. And "no key set up" still showing after
 * a successful import reads as the import having failed.
 */
function PgpSettings(): JSX.Element {
  const [refreshToken, setRefreshToken] = useState(0)

  return (
    <>
      <KeyTransferSection onImported={() => setRefreshToken((n) => n + 1)} />
      <AccountScope>
        {(account) => <PgpSection account={account} refreshToken={refreshToken} />}
      </AccountScope>
    </>
  )
}

export default PgpSettings
