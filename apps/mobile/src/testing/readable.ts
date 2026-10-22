import type { ReadableMessage } from '../messageText'

/** A message as the screens hold it, for tests: a short lunch invitation, with what the test changes written over it. */
export const readable = (over: Partial<ReadableMessage> = {}): ReadableMessage => ({
  subject: 'Lunch',
  from: 'Anna <anna@example.net>',
  to: 'Alex <alex@example.org>',
  cc: '',
  date: 'Mon, 19 Oct 2026 10:00:00 +0200',
  text: 'Shall we?',
  html: null,
  messageId: '<one@example.net>',
  references: '',
  replyTo: '',
  headers: {},
  inlineImages: {},
  ...over
})
