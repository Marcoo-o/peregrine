import { describe, expect, it } from 'vitest'
import { unsubscribeOffer } from '../reading/unsubscribeAdvice'
import { listFolders } from '../folders'
import { listMessages } from '../messages'
import { appHarness } from '../testing/appHarness'
import type { ComposeState, MessageState } from './screens'

// The domains are not like the example.org of the accounts in the tests: a sender that looks like one of the user's own is held back, as it should be.
const crlf = (lines: string[]): string => lines.join('\r\n')

const NEWSLETTER = crlf([
  'From: Lists <news@lists.northwind.test>',
  'Subject: Weekly',
  'List-Unsubscribe: <mailto:leave@lists.northwind.test?subject=unsubscribe>, <https://lists.northwind.test/u/abc123>',
  'List-Unsubscribe-Post: List-Unsubscribe=One-Click',
  'Content-Type: text/plain',
  '',
  'Hello.',
  ''
])

/** The same, with what a server says of a forged message. */
const FORGED = crlf([
  'From: "service@bank.example" <phish@lists.northwind.test>',
  'Subject: Weekly',
  'Authentication-Results: mx.example.org; spf=fail; dkim=none; dmarc=fail',
  'List-Unsubscribe: <https://lists.northwind.test/u/abc123>',
  'List-Unsubscribe-Post: List-Unsubscribe=One-Click',
  'Content-Type: text/plain',
  '',
  'Please log in.',
  ''
])

async function opened(source: string) {
  const t = await appHarness()
  const work = await t.givenAccount('work', { INBOX: [{ uid: 1, subject: 'Weekly', source }], Trash: [], Archive: [], Junk: [] })
  const folder = t.folderOf(await listFolders(t.db, work.id), 'INBOX')
  const summary = (await listMessages(t.db, folder.id))[0]
  await t.app.services.connections.ensure(work)
  await t.app.messages.open(work, folder, summary, 'folder')
  const state = t.store.screen as MessageState
  return { ...t, work, state }
}

describe('what a message offers for leaving its list', () => {
  it('is read from its headers, with one click preferred', async () => {
    const t = await opened(NEWSLETTER)
    const offer = unsubscribeOffer(t.state.message, t.state.assessment, 'news@lists.northwind.test')
    expect(offer?.advice).toMatchObject({ mode: 'one-click', blocked: false, target: 'lists.northwind.test' })
    expect(offer?.options.mail?.to).toBe('leave@lists.northwind.test')
  })

  it('is not offered for a message that looks wrong, which is what a forged newsletter is', async () => {
    const t = await opened(FORGED)
    const offer = unsubscribeOffer(t.state.message, t.state.assessment, 'phish@lists.northwind.test')
    expect(offer?.advice).toMatchObject({ mode: null, blocked: true })
  })

  it('is nothing for a message without the header', async () => {
    const t = await opened(crlf(['From: Sam <sam@contoso.test>', 'Subject: Hi', 'Content-Type: text/plain', '', 'Hi', '']))
    expect(unsubscribeOffer(t.state.message, t.state.assessment, 'sam@contoso.test')).toBeNull()
  })
})

describe('unsubscribing', () => {
  it('with one click sends the request and says on the message that the list took it', async () => {
    const t = await opened(NEWSLETTER)
    await t.app.messages.unsubscribeOneClick(t.state, { url: 'https://lists.northwind.test/u/abc123', host: 'lists.northwind.test' })
    expect(t.unsubscriber.posted).toEqual(['https://lists.northwind.test/u/abc123'])
    expect((t.store.screen as MessageState).notice).toContain('Abgemeldet: lists.northwind.test')
  })

  it('with one click says why it did not work, and stays on the message', async () => {
    const t = await opened(NEWSLETTER)
    t.unsubscriber.failWith = new Error('the server answered 500')
    await t.app.messages.unsubscribeOneClick(t.state, { url: 'https://lists.northwind.test/u/abc123', host: 'lists.northwind.test' })
    expect(t.store.screen.name).toBe('message')
    expect((t.store.screen as MessageState).notice).toContain('ging nicht')
  })

  it('with a message opens one to be read and sent by the user, from the account the list wrote to', async () => {
    const t = await opened(NEWSLETTER)
    t.app.compose.startUnsubscribeMail(t.state, { to: 'leave@lists.northwind.test', subject: 'unsubscribe', body: '' })
    const screen = t.store.screen as ComposeState
    expect(screen.name).toBe('compose')
    expect(screen.account.id).toBe(t.work.id)
    expect(screen.draft).toMatchObject({ to: 'leave@lists.northwind.test', subject: 'unsubscribe' })
  })

  it('asks for the word that lists read when the header gave no subject', async () => {
    const t = await opened(NEWSLETTER)
    t.app.compose.startUnsubscribeMail(t.state, { to: 'leave@lists.northwind.test', subject: '', body: '' })
    expect((t.store.screen as ComposeState).draft.subject).toBe('unsubscribe')
  })
})
