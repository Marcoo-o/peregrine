import { describe, expect, it } from 'vitest'
import { emptyDraft } from './draft'
import type { Identity } from './identities'
import { identityForSender, SIGNATURE_MARK, swapSignature, withIdentity, withoutSignature, withSignature } from './signature'

const identity = (id: string, address: string, signature = ''): Identity => ({
  id,
  accountId: 'a1',
  displayName: '',
  emailAddress: address,
  signature,
  isDefault: false,
  sortOrder: 0
})

describe('a signature under a message', () => {
  it('is put after two line breaks and the mark, which is two hyphens and a space', () => {
    expect(SIGNATURE_MARK).toBe('-- ')
    expect(withSignature('Hello', 'Best,\nAlex')).toBe('Hello\n\n-- \nBest,\nAlex')
  })

  it('is put under an empty message, so that there is room to type above it', () => {
    expect(withSignature('', 'Alex')).toBe('\n\n-- \nAlex')
  })

  it('is not put when it is empty, and its line breaks are those of a message', () => {
    expect(withSignature('Hello', '  \n ')).toBe('Hello')
    expect(withSignature('Hello', 'A\r\nB')).toBe('Hello\n\n-- \nA\nB')
  })

  it('is taken out again when the message ends with it, and nothing else is cut', () => {
    const body = withSignature('Hello', 'Alex')
    expect(withoutSignature(body, 'Alex')).toBe('Hello')
    expect(withoutSignature('Hello\n\n-- \nSomeone else', 'Alex')).toBe('Hello\n\n-- \nSomeone else')
    expect(withoutSignature('Hello', '')).toBe('Hello')
    expect(withoutSignature(`${body}\n\n`, 'Alex')).toBe('Hello')
  })

  it('is exchanged for another', () => {
    expect(swapSignature(withSignature('Hello', 'Alex'), 'Alex', 'Work team')).toBe('Hello\n\n-- \nWork team')
  })
})

describe('writing from another identity', () => {
  const home = identity('i1', 'home@example.org', 'Alex')
  const work = identity('i2', 'work@example.org', 'Work team')
  const plain = identity('i3', 'plain@example.org')

  it('names it, and exchanges the signature under the text', () => {
    const draft = { ...emptyDraft, body: withSignature('Hello', home.signature), identityId: home.id }
    const next = withIdentity(draft, home, work)
    expect(next).toMatchObject({ identityId: 'i2', body: 'Hello\n\n-- \nWork team' })
  })

  it('leaves a signature that was changed by hand, and does not add another over it', () => {
    const draft = { ...emptyDraft, body: 'Hello\n\n-- \nAlex (edited)', identityId: home.id }
    expect(withIdentity(draft, home, work).body).toBe('Hello\n\n-- \nAlex (edited)')
  })

  it('adds the signature when the identity it comes from had none, and takes it out when the one it goes to has none', () => {
    expect(withIdentity({ ...emptyDraft, body: 'Hello' }, plain, work).body).toBe('Hello\n\n-- \nWork team')
    expect(withIdentity({ ...emptyDraft, body: 'Hello\n\n-- \nWork team' }, work, plain).body).toBe('Hello')
  })

  it('starts from none: a message without an identity gets the signature of the one it is given', () => {
    expect(withIdentity({ ...emptyDraft, body: '' }, undefined, home)).toMatchObject({ identityId: 'i1', body: '\n\n-- \nAlex' })
  })
})

describe('the identity of a sender that is written down', () => {
  const identities = [identity('i1', 'home@example.org'), identity('i2', 'Work@example.org')]

  it('is the one with that address, whatever the case and with or without a name', () => {
    expect(identityForSender(identities, 'work@example.org')?.id).toBe('i2')
    expect(identityForSender(identities, 'Alex <WORK@example.org>')?.id).toBe('i2')
  })

  it('is the first for an address nobody has', () => {
    expect(identityForSender(identities, 'other@example.net')?.id).toBe('i1')
    expect(identityForSender([], 'other@example.net')).toBeUndefined()
  })
})
