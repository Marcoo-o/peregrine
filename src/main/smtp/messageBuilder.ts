import MailComposer from 'nodemailer/lib/mail-composer'

export interface OutgoingMessage {
  from: string
  to: string[]
  cc: string[]
  bcc: string[]
  subject: string
  text: string
  html: string
  attachments: { filename: string; path: string }[]
  inReplyTo?: string
  references?: string
}

/**
 * Compiles a message into RFC822 source. Separate from SmtpClient because drafts are built
 * and appended over IMAP without any SMTP connection being involved.
 */
export function buildRawMessage(message: OutgoingMessage): Promise<Buffer> {
  const composer = new MailComposer(message)
  return new Promise((resolve, reject) => {
    composer.compile().build((err, buffer) => {
      if (err) reject(err)
      else resolve(buffer)
    })
  })
}
