import { describe, expect, it } from 'vitest'
import { KEYSERVER, PublishError, publishKey, type Poster } from './keyPublish'

/** A server that answers each path as it is told to, and writes down what it was sent. */
function server(answers: Record<string, { ok?: boolean; status?: number; body?: unknown } | Error>) {
  const sent: Array<{ path: string; body: Record<string, unknown> }> = []
  const poster: Poster = async (url, init) => {
    const path = url.slice(KEYSERVER.length)
    sent.push({ path, body: JSON.parse(init.body) as Record<string, unknown> })
    const answer = answers[path]
    if (answer instanceof Error) throw answer
    if (!answer) throw new Error(`no answer for ${path}`)
    return { ok: answer.ok ?? true, status: answer.status ?? 200, json: async () => answer.body ?? {} }
  }
  return { poster, sent }
}

describe('publishing a key', () => {
  it('uploads it, and asks for the mail that confirms the address, which is what is true of it afterwards', async () => {
    const t = server({
      '/vks/v1/upload': { body: { key_fpr: 'ABCD', token: 'tok', status: { 'alex@example.org': 'unpublished' } } },
      '/vks/v1/request-verify': { body: {} }
    })
    expect(await publishKey('-----BEGIN PGP PUBLIC KEY BLOCK-----', 'Alex@Example.org', t.poster)).toEqual({ fingerprint: 'ABCD', confirmed: false, mailSent: true })
    expect(t.sent[0]).toEqual({ path: '/vks/v1/upload', body: { keytext: '-----BEGIN PGP PUBLIC KEY BLOCK-----' } })
    expect(t.sent[1]).toEqual({ path: '/vks/v1/request-verify', body: { token: 'tok', addresses: ['Alex@Example.org'], locale: ['de'] } })
  })

  it('asks for no mail when the address is confirmed already, and says so', async () => {
    const t = server({ '/vks/v1/upload': { body: { key_fpr: 'ABCD', token: 'tok', status: { 'alex@example.org': 'published' } } } })
    expect(await publishKey('k', 'alex@example.org', t.poster)).toEqual({ fingerprint: 'ABCD', confirmed: true, mailSent: false })
    expect(t.sent).toHaveLength(1)
  })

  it('says that the server refused, with its reason, and asks for no mail then', async () => {
    const t = server({ '/vks/v1/upload': { ok: false, status: 400, body: { error: 'Malformed key' } } })
    await expect(publishKey('k', 'alex@example.org', t.poster)).rejects.toMatchObject({ failure: 'refused', detail: 'Malformed key' })
    expect(t.sent).toHaveLength(1)
  })

  it('says what the status was when the server gave no reason', async () => {
    const t = server({ '/vks/v1/upload': { ok: false, status: 503 } })
    await expect(publishKey('k', 'alex@example.org', t.poster)).rejects.toMatchObject({ failure: 'refused', detail: expect.stringContaining('503') })
  })

  it('says that nobody can be asked when the server did not give a token, which it does not for a key without the address', async () => {
    const t = server({ '/vks/v1/upload': { body: { key_fpr: 'ABCD', status: {} } } })
    await expect(publishKey('k', 'alex@example.org', t.poster)).rejects.toMatchObject({ failure: 'refused' })
  })

  it('says that the server could not be reached, for a network that is down and for a server that does not answer in time', async () => {
    const down = server({ '/vks/v1/upload': new Error('Network request failed') })
    await expect(publishKey('k', 'a@example.org', down.poster)).rejects.toMatchObject({ failure: 'unreachable' })

    const silent: Poster = (_url, init) =>
      new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))))
    await expect(publishKey('k', 'a@example.org', silent, 20)).rejects.toBeInstanceOf(PublishError)
    await expect(publishKey('k', 'a@example.org', silent, 20)).rejects.toMatchObject({ failure: 'unreachable' })
  })

  it('says that the second step was refused, when the key is up and the mail could not be asked for', async () => {
    const t = server({
      '/vks/v1/upload': { body: { key_fpr: 'ABCD', token: 'tok', status: { 'alex@example.org': 'unpublished' } } },
      '/vks/v1/request-verify': { ok: false, status: 429, body: { error: 'Too many requests' } }
    })
    await expect(publishKey('k', 'alex@example.org', t.poster)).rejects.toMatchObject({ failure: 'refused', detail: 'Too many requests' })
  })
})
