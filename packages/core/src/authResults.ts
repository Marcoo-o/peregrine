/**
 * Reads the `Authentication-Results` header.
 *
 * This is the one check that is not a judgement about how text looks: the receiving server
 * states whether the sending server was actually authorised to send for that domain. A
 * `dmarc=fail` means the sender is forged, not that it might be.
 *
 * Only the first header is read. Every relay may append one, and a forged mail can carry any
 * number of self-written ones. But the receiving server puts its own on top, so the topmost
 * is the only one that was not written by whoever sent the message.
 */

export type AuthVerdict = 'pass' | 'fail' | 'softfail' | 'neutral' | 'none' | 'unknown'

export interface AuthResults {
  spf: AuthVerdict
  dkim: AuthVerdict
  dmarc: AuthVerdict
}

const KNOWN: AuthVerdict[] = ['pass', 'fail', 'softfail', 'neutral', 'none']

function verdictFor(header: string, method: 'spf' | 'dkim' | 'dmarc'): AuthVerdict {
  const match = new RegExp(`\\b${method}\\s*=\\s*([a-z]+)`, 'i').exec(header)
  if (!match) return 'unknown'
  const value = match[1].toLowerCase() as AuthVerdict
  return KNOWN.includes(value) ? value : 'unknown'
}

export function parseAuthenticationResults(header: string | null | undefined): AuthResults {
  const first = (header ?? '').split(/\r?\n(?=[^\s])/)[0] ?? ''
  return {
    spf: verdictFor(first, 'spf'),
    dkim: verdictFor(first, 'dkim'),
    dmarc: verdictFor(first, 'dmarc')
  }
}

/**
 * Whether the result is worth showing.
 *
 * A pass is the normal case and saying so on every message would be noise; `unknown` and
 * `none` mean the check did not run, which says nothing about the message. Only an outright
 * failure is information.
 */
export function failedChecks(results: AuthResults): Array<keyof AuthResults> {
  return (['dmarc', 'spf', 'dkim'] as const).filter(
    (key) => results[key] === 'fail' || results[key] === 'softfail'
  )
}
