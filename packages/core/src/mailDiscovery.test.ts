import { describe, expect, it } from 'vitest'
import type { DiscoveredConfig } from './autoconfig'
import { discoverMailConfig, type FetchText } from './mailDiscovery'

const document = (host: string): string => `<clientConfig><emailProvider id="example">
  <displayName>Example</displayName>
  <incomingServer type="imap"><hostname>${host}</hostname><port>993</port><socketType>SSL</socketType><username>%EMAILADDRESS%</username><authentication>password-cleartext</authentication></incomingServer>
  <outgoingServer type="smtp"><hostname>smtp.${host}</hostname><port>587</port><socketType>STARTTLS</socketType><username>%EMAILADDRESS%</username><authentication>password-cleartext</authentication></outgoingServer>
</emailProvider></clientConfig>`

/** The web as a table of what it serves, which keeps what was asked, and answers null for everything else. */
function web(served: Record<string, string>) {
  const asked: string[] = []
  const fetchText: FetchText = async (url) => {
    asked.push(url)
    return served[url] ?? null
  }
  return { fetchText, asked }
}

const PROVIDER = 'https://autoconfig.example.net/mail/config-v1.1.xml?emailaddress=sam%40example.net'
const WELL_KNOWN = 'https://example.net/.well-known/autoconfig/mail/config-v1.1.xml?emailaddress=sam%40example.net'
const MOZILLA = 'https://autoconfig.thunderbird.net/v1.1/example.net'

describe('finding the servers of an address', () => {
  it('takes what the provider publishes, and does not ask outsiders', async () => {
    const t = web({ [PROVIDER]: document('imap.example.net'), [MOZILLA]: document('imap.other.test') })
    const found = await discoverMailConfig('sam@example.net', t.fetchText)
    expect(found).toMatchObject({ found: true, source: 'provider', config: { imap: { host: 'imap.example.net', port: 993, secure: 'tls', username: 'sam@example.net' } } })
    expect(t.asked).toEqual([PROVIDER, WELL_KNOWN])
  })

  it('takes the main host of the domain when the subdomain has nothing, and the provider before it when both have', async () => {
    const onlyMainHost = web({ [WELL_KNOWN]: document('imap.example.net') })
    expect(await discoverMailConfig('sam@example.net', onlyMainHost.fetchText)).toMatchObject({ source: 'wellKnown' })
    const both = web({ [PROVIDER]: document('imap.first.test'), [WELL_KNOWN]: document('imap.second.test') })
    expect(await discoverMailConfig('sam@example.net', both.fetchText)).toMatchObject({ source: 'provider', config: { imap: { host: 'imap.first.test' } } })
  })

  it("asks Mozilla's database, with the domain only, when the provider publishes nothing", async () => {
    const t = web({ [MOZILLA]: document('imap.example.net') })
    expect(await discoverMailConfig('sam@example.net', t.fetchText)).toMatchObject({ found: true, source: 'mozilla' })
    expect(t.asked.filter((url) => url.includes('thunderbird.net'))).toEqual([MOZILLA])
    expect(t.asked.filter((url) => url === MOZILLA).join('')).not.toContain('sam')
  })

  it('asks over HTTPS only', async () => {
    const t = web({})
    await discoverMailConfig('sam@example.net', t.fetchText)
    expect(t.asked.every((url) => url.startsWith('https://'))).toBe(true)
  })

  it('passes over a document that is no configuration, and goes on to the next source', async () => {
    const t = web({ [PROVIDER]: '<html>Welcome</html>', [WELL_KNOWN]: document('imap.example.net') })
    expect(await discoverMailConfig('sam@example.net', t.fetchText)).toMatchObject({ source: 'wellKnown' })
  })

  it('uses what the platform gives from DNS only when nobody published anything', async () => {
    const config: DiscoveredConfig = {
      displayName: 'example.net',
      imap: { host: 'mail.example.net', port: 993, secure: 'tls', username: 'sam@example.net', authType: 'password' },
      smtp: { host: 'mail.example.net', port: 465, secure: 'tls', username: 'sam@example.net', authType: 'password' }
    }
    const srv = async () => config
    expect(await discoverMailConfig('sam@example.net', web({}).fetchText, srv)).toEqual({ found: true, source: 'srv', config })
    expect(await discoverMailConfig('sam@example.net', web({ [MOZILLA]: document('imap.example.net') }).fetchText, srv)).toMatchObject({ source: 'mozilla' })
  })

  it('says that nothing was found, for a domain nobody knows and for what is no address', async () => {
    expect(await discoverMailConfig('sam@example.net', web({}).fetchText)).toEqual({ found: false })
    const t = web({})
    expect(await discoverMailConfig('nobody', t.fetchText)).toEqual({ found: false })
    expect(await discoverMailConfig('nobody@', t.fetchText)).toEqual({ found: false })
    expect(t.asked).toEqual([])
  })

  it('reports a provider that wants OAuth2 as that, and does not hide it', async () => {
    const oauth = document('imap.example.net').replace(/password-cleartext/g, 'OAuth2')
    const found = await discoverMailConfig('sam@example.net', web({ [PROVIDER]: oauth }).fetchText)
    expect(found).toMatchObject({ found: true, config: { imap: { authType: 'oauth2' } } })
  })
})
