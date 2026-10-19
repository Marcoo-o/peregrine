import type { ImapSession, ImapSessionOptions } from '@peregrine/core/imapSession'
import type { LogEvent } from '@peregrine/imap/client'
import { ImapClientSession } from '@peregrine/imap/session'
import { protocolLog } from '../diagnostics/protocolLog'
import { ImapConnection } from './ImapConnection'
import { NodeTransport } from './NodeTransport'

/**
 * Feeds what the built-in client says and hears into the same diagnostics log imapflow writes to.
 *
 * A server line that begins `* 12 FETCH` is one of the thousands a sync produces, and goes in as
 * bulk, which the log leaves out unless asked, exactly as it does for imapflow. The client masks
 * credentials itself before a line gets here, and the log redacts again on its own account.
 */
export function protocolSink(connection: string): (event: LogEvent) => void {
  return (event) => {
    const bulk = event.direction === 'S' && /^\* \d+ FETCH\b/.test(event.text)
    protocolLog.record(connection, event.direction === 'C' ? 'client' : 'server', event.text, { bulk })
  }
}

/**
 * The one place that decides which implementation answers for an account.
 *
 * imapflow is the default. The built-in client is chosen with a setting that says so, and the
 * choice is made when the connection is created, so it takes effect the next time an account
 * connects and never switches one that is running.
 */
export function createImapSession(options: ImapSessionOptions, useBuiltIn: boolean): ImapSession {
  if (!useBuiltIn) return new ImapConnection(options)
  return new ImapClientSession(options, {
    transport: new NodeTransport(),
    log: options.label ? protocolSink(options.label) : undefined
  })
}
