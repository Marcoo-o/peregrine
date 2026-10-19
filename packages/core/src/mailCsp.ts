/**
 * The policy a message document is served under.
 *
 * Built here and applied by the main process, from a description of what the document is for
 * rather than from a policy the caller wrote out. Before this, the window sent the finished
 * header text and the main process passed it on, which put the last barrier around untrusted
 * HTML on the same side as the HTML itself. Now the window says what it wants to show and the
 * main process decides what that is allowed to do.
 */

export type MailSurface = 'reader' | 'print'

export interface MailContentPolicy {
  surface: MailSurface
  /** Whether images may be fetched from the sender's servers. */
  allowRemoteImages: boolean
  /**
   * Base64 SHA-256 of the height reporting script, which only the reading pane injects.
   *
   * Checked against the shape of a digest before it is used. It is the one part of the policy
   * that carries a value rather than a decision, and an unchecked value written into a header
   * is how a policy stops meaning what it reads like.
   */
  scriptHash?: string
}

const DIGEST = /^[A-Za-z0-9+/]{43}=$/

function imageSources(surface: MailSurface, allowRemote: boolean): string {
  // Only the print document still refers to parts by content id. The reading pane has already
  // turned those into data URLs by the time it publishes.
  const local = surface === 'print' ? 'data: cid:' : 'data:'
  return allowRemote ? `${local} https: http:` : local
}

export function mailContentCsp(policy: MailContentPolicy): string {
  const directives = [
    "default-src 'none'",
    `img-src ${imageSources(policy.surface, policy.allowRemoteImages)}`,
    "style-src 'unsafe-inline'",
    // Neither falls back to default-src, so 'none' has to be said out loud. Without form-action
    // a message could submit a form anywhere it liked, and without base-uri it could point
    // every relative URL in the document somewhere else.
    "form-action 'none'",
    "base-uri 'none'"
  ]

  if (policy.surface === 'reader' && policy.scriptHash && DIGEST.test(policy.scriptHash)) {
    directives.push(`script-src 'sha256-${policy.scriptHash}'`)
  }

  return directives.join('; ') + ';'
}
