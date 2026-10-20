import { describe, expect, it } from 'vitest'
import { account } from '../testing/appHarness'
import {
  imapLoginOf,
  initialFields,
  isSubmittable,
  newAccountFrom,
  toAccountForm,
  withImapSecurity,
  withSmtpSecurity,
  type AccountForm,
  type FormFields
} from './accountForm'

const filled = (over: Partial<FormFields> = {}): FormFields => ({
  ...initialFields(),
  host: 'imap.example.org',
  username: 'alex',
  password: 'secret',
  ...over
})

const form = (over: Partial<AccountForm> = {}): AccountForm => ({
  email: '',
  host: 'imap.example.org',
  port: 993,
  secure: 'tls',
  username: 'alex',
  password: 'secret',
  smtpHost: '',
  smtpPort: 587,
  smtpSecure: 'starttls',
  ...over
})

describe('the fields of the form', () => {
  it('are empty with the usual ports when there was no attempt before', () => {
    expect(initialFields()).toEqual({
      email: '',
      host: '',
      port: '993',
      secure: 'tls',
      username: '',
      password: '',
      smtpHost: '',
      smtpPort: '587',
      smtpSecure: 'starttls'
    })
  })

  it('are what was typed last, so that nobody types it again', () => {
    const typed = form({ email: 'a@example.org', port: 143, secure: 'starttls', smtpHost: 'smtp.example.org', smtpPort: 465, smtpSecure: 'tls' })
    expect(initialFields(typed)).toMatchObject({
      email: 'a@example.org',
      port: '143',
      secure: 'starttls',
      smtpHost: 'smtp.example.org',
      smtpPort: '465',
      smtpSecure: 'tls'
    })
  })

  it('take the usual port with the kind of connection, for reading and for sending', () => {
    expect(withImapSecurity(filled(), 'starttls')).toMatchObject({ secure: 'starttls', port: '143' })
    expect(withImapSecurity(filled({ port: '143' }), 'tls')).toMatchObject({ secure: 'tls', port: '993' })
    expect(withSmtpSecurity(filled(), 'tls')).toMatchObject({ smtpSecure: 'tls', smtpPort: '465' })
    expect(withSmtpSecurity(filled(), 'starttls')).toMatchObject({ smtpSecure: 'starttls', smtpPort: '587' })
  })

  it('leave the other fields alone when the connection is chosen', () => {
    const changed = withImapSecurity(filled({ email: 'a@example.org' }), 'starttls')
    expect(changed.email).toBe('a@example.org')
    expect(changed.smtpPort).toBe('587')
  })
})

describe('whether the form can be submitted', () => {
  it('takes a server, a login and a port for reading', () => {
    expect(isSubmittable(filled())).toBe(true)
    expect(isSubmittable(filled({ host: '  ' }))).toBe(false)
    expect(isSubmittable(filled({ username: '' }))).toBe(false)
    expect(isSubmittable(filled({ password: '' }))).toBe(false)
    expect(isSubmittable(filled({ port: '0' }))).toBe(false)
    expect(isSubmittable(filled({ port: 'abc' }))).toBe(false)
  })

  it('does not ask for a port for sending when there is no server for it', () => {
    expect(isSubmittable(filled({ smtpHost: '', smtpPort: '' }))).toBe(true)
  })

  it('asks for a port for sending when there is a server for it', () => {
    expect(isSubmittable(filled({ smtpHost: 'smtp.example.org', smtpPort: '' }))).toBe(false)
    expect(isSubmittable(filled({ smtpHost: 'smtp.example.org', smtpPort: '587' }))).toBe(true)
  })
})

describe('the form as it is submitted', () => {
  it('has numbers for the ports and a server without the blanks around it', () => {
    const submitted = toAccountForm(filled({ host: ' imap.example.org ', port: '1993', smtpPort: '2587' }))
    expect(submitted).toMatchObject({ host: 'imap.example.org', port: 1993, smtpPort: 2587 })
  })
})

describe('the account that is made from the form', () => {
  it('is named by the address that was given', () => {
    expect(newAccountFrom(form({ email: ' alex@example.org ' }))).toMatchObject({
      displayName: 'alex@example.org',
      emailAddress: 'alex@example.org'
    })
  })

  it('takes the user name for the address when it is one, and for the name when there is no address', () => {
    expect(newAccountFrom(form({ username: 'alex@example.org' }))).toMatchObject({ emailAddress: 'alex@example.org' })
    expect(newAccountFrom(form({ username: 'alex' }))).toMatchObject({ displayName: 'alex', emailAddress: '' })
  })

  it('sends when there is a server for it, and only reads when there is not', () => {
    const sends = newAccountFrom(form({ smtpHost: ' smtp.example.org ', smtpPort: 465, smtpSecure: 'tls' }))
    expect(sends).toMatchObject({ smtpHost: 'smtp.example.org', smtpPort: 465, smtpSecure: 'tls' })
    const reads = newAccountFrom(form({ smtpHost: '   ' }))
    expect(reads).toMatchObject({ smtpHost: null, smtpPort: null, smtpSecure: null })
  })

  it('uses the same login for sending, which is why none is stored for it', () => {
    expect(newAccountFrom(form())).toMatchObject({ smtpUsername: null, smtpPassword: null, password: 'secret' })
  })
})

describe('the login of an account', () => {
  it('is what it takes to connect to its mailbox', () => {
    const stored = { ...account('work'), id: 'x', createdAt: 0 }
    expect(imapLoginOf(stored)).toEqual({ host: 'imap.example.org', port: 993, secure: 'tls', username: 'work', password: 'secret' })
  })
})
