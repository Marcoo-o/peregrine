import { describe, expect, it } from 'vitest'
import { addAccount, getAccount, updateAccount } from './accounts'
import { appHarness, account } from './testing/appHarness'

describe('changing an account', () => {
  async function stored() {
    const t = await appHarness()
    const input = account('work', { smtpHost: 'smtp.example.org', smtpPort: 587, smtpSecure: 'starttls' })
    return { db: t.db, added: await addAccount(t.db, input) }
  }

  it('changes what is in the patch and leaves the rest', async () => {
    const { db, added } = await stored()
    const changed = await updateAccount(db, added.id, { displayName: 'Work', imapPort: 143, color: '#b03a5b' })
    expect(changed).toEqual({ ...added, displayName: 'Work', imapPort: 143, color: '#b03a5b' })
    expect(await getAccount(db, added.id)).toEqual(changed)
  })

  it('stores null as nothing, which takes the server for sending away', async () => {
    const { db, added } = await stored()
    const changed = await updateAccount(db, added.id, { smtpHost: null, smtpPort: null, smtpSecure: null })
    expect(changed).toMatchObject({ smtpHost: null, smtpPort: null, smtpSecure: null, imapHost: added.imapHost })
  })

  it('changes nothing for an empty patch, and nothing for an account that is not there', async () => {
    const { db, added } = await stored()
    expect(await updateAccount(db, added.id, {})).toEqual(added)
    expect(await updateAccount(db, 'nobody', { displayName: 'x' })).toBeUndefined()
  })
})
