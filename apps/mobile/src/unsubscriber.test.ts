import { describe, expect, it } from 'vitest'
import { language, useSystemLanguages } from './i18n'
import { FetchUnsubscriber, type Fetcher } from './unsubscriber'

// The tests run in German, whatever the machine they run on is set to.
useSystemLanguages(() => ['de'])
language.apply('system')

const URL_OK = 'https://lists.example.net/u/abc123'

describe('asking a list to take the address off with one click', () => {
  it('sends one POST with the body of RFC 8058, without cookies or login', async () => {
    const seen: Array<{ url: string; init: Parameters<Fetcher>[1] }> = []
    const unsubscriber = new FetchUnsubscriber(async (url, init) => {
      seen.push({ url, init })
      return { ok: true, status: 200 }
    })
    await unsubscriber.post(URL_OK)
    expect(seen).toHaveLength(1)
    expect(seen[0].url).toBe(URL_OK)
    expect(seen[0].init).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'List-Unsubscribe=One-Click',
      credentials: 'omit',
      cache: 'no-store'
    })
  })

  it('says what the server answered when it does not take it', async () => {
    const unsubscriber = new FetchUnsubscriber(async () => ({ ok: false, status: 404 }))
    await expect(unsubscriber.post(URL_OK)).rejects.toThrow('404')
  })

  it('does not go to an address that is not safe, and does not ask the network', async () => {
    let asked = 0
    const unsubscriber = new FetchUnsubscriber(async () => {
      asked += 1
      return { ok: true, status: 200 }
    })
    await expect(unsubscriber.post('http://lists.example.net/u')).rejects.toThrow('sicher')
    await expect(unsubscriber.post('https://192.168.0.1/u')).rejects.toThrow('sicher')
    expect(asked).toBe(0)
  })

  it('gives up when there is no answer in time', async () => {
    const unsubscriber = new FetchUnsubscriber(
      (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))),
      20
    )
    await expect(unsubscriber.post(URL_OK)).rejects.toThrow('rechtzeitig')
  })
})
