import { describe, expect, it } from 'vitest'
import { findServers, foundText, textFetcher, type Fetcher } from './discovery'

const document = (host: string, auth = 'password-cleartext'): string => `<clientConfig><emailProvider id="example">
  <displayName>Example</displayName>
  <incomingServer type="imap"><hostname>${host}</hostname><port>993</port><socketType>SSL</socketType><username>%EMAILLOCALPART%</username><authentication>${auth}</authentication></incomingServer>
  <outgoingServer type="smtp"><hostname>smtp.${host}</hostname><port>587</port><socketType>STARTTLS</socketType><username>%EMAILLOCALPART%</username><authentication>${auth}</authentication></outgoingServer>
</emailProvider></clientConfig>`

/** The web as a table of what it serves, with what was asked of it. */
function web(served: Record<string, string>) {
  const asked: string[] = []
  const fetcher: Fetcher = async (url) => {
    asked.push(url)
    const text = served[url]
    return text === undefined ? { ok: false, text: async () => '' } : { ok: true, text: async () => text }
  }
  return { fetcher, asked }
}

describe('the servers of an address', () => {
  it('are known for a large provider by the domain, without a request', async () => {
    const t = web({})
    const found = await findServers('Sam@Gmail.com', t.fetcher)
    expect(found).toMatchObject({
      source: 'preset',
      label: 'Gmail',
      imap: { host: 'imap.gmail.com', port: 993, secure: 'tls', username: 'Sam@Gmail.com' },
      smtp: { host: 'smtp.gmail.com', port: 465, secure: 'tls' },
      oauth2: false
    })
    expect(found?.appPasswordUrl).toMatch(/^https:\/\//)
    expect(t.asked).toEqual([])
  })

  it('are what the provider publishes, with the login as the document says it', async () => {
    const t = web({ 'https://autoconfig.example.net/mail/config-v1.1.xml?emailaddress=sam%40example.net': document('imap.example.net') })
    expect(await findServers('sam@example.net', t.fetcher)).toMatchObject({
      source: 'provider',
      imap: { host: 'imap.example.net', port: 993, secure: 'tls', username: 'sam' },
      smtp: { host: 'smtp.imap.example.net', port: 587, secure: 'starttls' },
      oauth2: false
    })
  })

  it('are told to be OAuth2 when that is what the provider wants', async () => {
    const t = web({ 'https://autoconfig.example.net/mail/config-v1.1.xml?emailaddress=sam%40example.net': document('imap.example.net', 'OAuth2') })
    expect(await findServers('sam@example.net', t.fetcher)).toMatchObject({ oauth2: true })
  })

  it('are nobody’s to give for a domain that publishes nothing', async () => {
    expect(await findServers('sam@example.net', web({}).fetcher)).toBeNull()
  })
})

describe('getting a document', () => {
  it('gives the text of what answers', async () => {
    const t = web({ 'https://x.test/a': 'hello' })
    expect(await textFetcher(t.fetcher)('https://x.test/a')).toBe('hello')
  })

  it('gives nothing for an answer that is no success, for a failure, and for a document that is too large', async () => {
    const t = web({ 'https://x.test/big': 'x'.repeat(300 * 1024) })
    expect(await textFetcher(t.fetcher)('https://x.test/none')).toBeNull()
    expect(await textFetcher(t.fetcher)('https://x.test/big')).toBeNull()
    const failing: Fetcher = async () => {
      throw new Error('network down')
    }
    expect(await textFetcher(failing)('https://x.test/a')).toBeNull()
  })

  it('gives up on a server that does not answer, and stops the request', async () => {
    let aborted = false
    const silent: Fetcher = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          aborted = true
          reject(new Error('aborted'))
        })
      })
    expect(await textFetcher(silent, 20)('https://x.test/a')).toBeNull()
    expect(aborted).toBe(true)
  })

  it('gives up on a request that does not even notice that it was stopped', async () => {
    const deaf: Fetcher = () => new Promise(() => undefined)
    expect(await textFetcher(deaf, 20)('https://x.test/a')).toBeNull()
  })

  it('asks for XML', async () => {
    let accept = ''
    const fetcher: Fetcher = async (_url, init) => {
      accept = init.headers.Accept
      return { ok: true, text: async () => '' }
    }
    await textFetcher(fetcher)('https://x.test/a')
    expect(accept).toContain('xml')
  })
})

describe('what the screen says of what was found', () => {
  it('says where it came from, and that only the domain went to Mozilla', async () => {
    const t = web({ 'https://autoconfig.thunderbird.net/v1.1/example.net': document('imap.example.net') })
    const found = await findServers('sam@example.net', t.fetcher)
    expect(foundText(found)).toMatch(/Mozilla.*nur die Domain/)
  })

  it('names a known provider, and says that it wants an app password', async () => {
    expect(foundText(await findServers('sam@gmail.com', web({}).fetcher))).toMatch(/Bekannter Anbieter: Gmail\..*App-Passwort/)
  })

  it('says that OAuth2 cannot be used and what may help', async () => {
    const t = web({ 'https://autoconfig.example.net/mail/config-v1.1.xml?emailaddress=sam%40example.net': document('imap.example.net', 'OAuth2') })
    expect(foundText(await findServers('sam@example.net', t.fetcher))).toMatch(/OAuth2.*nicht kann.*App-Passwort/)
  })

  it('says that nothing is published', () => {
    expect(foundText(null)).toMatch(/keine Einstellungen veröffentlicht/)
  })
})
