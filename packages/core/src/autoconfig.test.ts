import { describe, expect, it } from 'vitest'
import { parseAutoconfig, parseSocketType, resolveUsername } from './autoconfig'

/** The shape autoconfig.thunderbird.net actually serves, shortened. */
const MAILBOX_ORG = `<?xml version="1.0" encoding="UTF-8"?>
<clientConfig version="1.1">
  <emailProvider id="mailbox.org">
    <domain>mailbox.org</domain>
    <displayName>mailbox.org</displayName>
    <displayShortName>mailbox.org</displayShortName>
    <incomingServer type="imap">
      <hostname>imap.mailbox.org</hostname>
      <port>993</port>
      <socketType>SSL</socketType>
      <authentication>password-cleartext</authentication>
      <username>%EMAILADDRESS%</username>
    </incomingServer>
    <outgoingServer type="smtp">
      <hostname>smtp.mailbox.org</hostname>
      <port>587</port>
      <socketType>STARTTLS</socketType>
      <authentication>password-cleartext</authentication>
      <username>%EMAILADDRESS%</username>
    </outgoingServer>
  </emailProvider>
</clientConfig>`

describe('parseSocketType', () => {
  it('maps the three values of the format', () => {
    expect(parseSocketType('SSL')).toBe('tls')
    expect(parseSocketType('STARTTLS')).toBe('starttls')
    expect(parseSocketType('plain')).toBe('none')
  })

  it('is case insensitive and tolerates whitespace', () => {
    expect(parseSocketType(' ssl ')).toBe('tls')
    expect(parseSocketType('StartTLS')).toBe('starttls')
  })

  // Guessing here means a connection that will not come up, or one that goes out unencrypted.
  it('refuses to guess', () => {
    expect(parseSocketType('TLS1.2')).toBeNull()
    expect(parseSocketType('')).toBeNull()
    expect(parseSocketType(undefined)).toBeNull()
  })
})

describe('resolveUsername', () => {
  it('fills the placeholders', () => {
    expect(resolveUsername('%EMAILADDRESS%', 'anna@example.org')).toBe('anna@example.org')
    expect(resolveUsername('%EMAILLOCALPART%', 'anna@example.org')).toBe('anna')
    expect(resolveUsername('%EMAILDOMAIN%', 'anna@example.org')).toBe('example.org')
  })

  it('defaults to the full address', () => {
    expect(resolveUsername(undefined, 'anna@example.org')).toBe('anna@example.org')
  })

  it('leaves a fixed username alone', () => {
    expect(resolveUsername('service', 'anna@example.org')).toBe('service')
  })
})

describe('parseAutoconfig', () => {
  it('reads a real document', () => {
    const config = parseAutoconfig(MAILBOX_ORG, 'anna@mailbox.org')
    expect(config).toEqual({
      displayName: 'mailbox.org',
      imap: {
        host: 'imap.mailbox.org',
        port: 993,
        secure: 'tls',
        username: 'anna@mailbox.org',
        authType: 'password'
      },
      smtp: {
        host: 'smtp.mailbox.org',
        port: 587,
        secure: 'starttls',
        username: 'anna@mailbox.org',
        authType: 'password'
      }
    })
  })

  // Providers list POP3 first often enough that taking the first server is simply wrong.
  it('picks the imap server out of several', () => {
    const xml = MAILBOX_ORG.replace(
      '<incomingServer type="imap">',
      `<incomingServer type="pop3">
        <hostname>pop.mailbox.org</hostname>
        <port>995</port>
        <socketType>SSL</socketType>
        <username>%EMAILADDRESS%</username>
      </incomingServer>
      <incomingServer type="imap">`
    )
    expect(parseAutoconfig(xml, 'anna@mailbox.org')?.imap.host).toBe('imap.mailbox.org')
  })

  it('reports OAuth2 rather than passing it off as a password', () => {
    const xml = MAILBOX_ORG.replace(/password-cleartext/g, 'OAuth2')
    expect(parseAutoconfig(xml, 'anna@mailbox.org')?.imap.authType).toBe('oauth2')
  })

  // Half a configuration is worse than none: it looks finished and does not work.
  it('rejects a document without an outgoing server', () => {
    const xml = MAILBOX_ORG.replace(/<outgoingServer[\s\S]*?<\/outgoingServer>/, '')
    expect(parseAutoconfig(xml, 'anna@mailbox.org')).toBeNull()
  })

  it('rejects a document with only pop3', () => {
    const xml = MAILBOX_ORG.replace(/type="imap"/, 'type="pop3"')
    expect(parseAutoconfig(xml, 'anna@mailbox.org')).toBeNull()
  })

  it('rejects an unusable port', () => {
    expect(parseAutoconfig(MAILBOX_ORG.replace('<port>993</port>', '<port>0</port>'), 'a@b.de')).toBeNull()
    expect(parseAutoconfig(MAILBOX_ORG.replace('<port>993</port>', '<port>x</port>'), 'a@b.de')).toBeNull()
  })

  it('rejects an unknown socket type', () => {
    const xml = MAILBOX_ORG.replace('<socketType>SSL</socketType>', '<socketType>weird</socketType>')
    expect(parseAutoconfig(xml, 'a@b.de')).toBeNull()
  })

  it('rejects what is not a clientConfig at all', () => {
    expect(parseAutoconfig('<html><body>404</body></html>', 'a@b.de')).toBeNull()
    expect(parseAutoconfig('', 'a@b.de')).toBeNull()
  })

  it('decodes entities', () => {
    const xml = MAILBOX_ORG.replace('<displayName>mailbox.org</displayName>', '<displayName>Mail &amp; More</displayName>')
    expect(parseAutoconfig(xml, 'a@b.de')?.displayName).toBe('Mail & More')
  })

  it('falls back to the domain when there is no display name', () => {
    const xml = MAILBOX_ORG.replace(/<displayName>[\s\S]*?<\/displayName>/, '')
    expect(parseAutoconfig(xml, 'a@b.de')?.displayName).toBe('mailbox.org')
  })
})
