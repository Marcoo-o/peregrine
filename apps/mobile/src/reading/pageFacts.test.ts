import { describe, expect, it } from 'vitest'
import { MAIL_PAGE_SCRIPT, MAX_PAGE_HEIGHT, parsePageMessage, type PageMessage } from './pageFacts'

interface FakeElement {
  attributes: Record<string, string>
  textContent: string
  getAttribute: (name: string) => string | null
}

const element = (attributes: Record<string, string>, textContent = ''): FakeElement => ({
  attributes,
  textContent,
  getAttribute: (name) => attributes[name] ?? null
})

/** Runs the script the way the page does, against a document that has these elements, and returns what it posted. */
function runScript(links: FakeElement[], images: FakeElement[], height = 321.2): PageMessage[] {
  const posted: string[] = []
  const document = {
    querySelectorAll: (selector: string) => (selector === 'a[href]' ? links : selector === 'img' ? images : []),
    body: { getBoundingClientRect: () => ({ height }) }
  }
  const window = { ReactNativeWebView: { postMessage: (data: string) => posted.push(data) } }
  new Function('document', 'window', MAIL_PAGE_SCRIPT)(document, window)
  return posted.map((data) => parsePageMessage(data)).filter((message): message is PageMessage => message !== null)
}

describe('what the page reports about itself', () => {
  it('is its links with their text and its images with their size, and then how tall it is', () => {
    const messages = runScript(
      [element({ href: 'https://evil.test/x' }, '  https://paypal.com/\n  login ')],
      [element({ src: 'https://track.example.net/a.gif', width: '1', height: '1' })]
    )
    expect(messages).toEqual([
      {
        kind: 'page',
        facts: {
          links: [{ href: 'https://evil.test/x', text: 'https://paypal.com/ login' }],
          images: [{ src: 'https://track.example.net/a.gif', width: '1', height: '1', style: '' }]
        }
      },
      { kind: 'height', height: 322 }
    ])
  })

  it('does not report more than a page of mail has reason to have', () => {
    const many = Array.from({ length: 800 }, (_, n) => element({ href: `https://example.net/${n}` }, `link ${n}`))
    const [page] = runScript(many, [])
    expect(page.kind === 'page' && page.facts.links).toHaveLength(500)
  })
})

describe('reading what the page said', () => {
  const page = (body: unknown) => JSON.stringify({ kind: 'page', links: [], images: [], ...(body as object) })
  const factsOf = (data: string) => {
    const message = parsePageMessage(data)
    return message?.kind === 'page' ? message.facts : null
  }

  it('takes nothing that is not a message of this kind', () => {
    expect(parsePageMessage('not json')).toBeNull()
    expect(parsePageMessage('null')).toBeNull()
    expect(parsePageMessage('[]')).toBeNull()
    expect(parsePageMessage(JSON.stringify({ kind: 'other', links: [], images: [] }))).toBeNull()
    expect(parsePageMessage(JSON.stringify({ kind: 'page', links: 'x', images: [] }))).toBeNull()
  })

  it('drops the entries that are not what they should be and keeps the others', () => {
    const facts = factsOf(
      page({
        links: [{ href: 'https://a.test', text: 'a' }, { href: 5, text: 'b' }, null, { text: 'no href' }],
        images: [{ src: 'x', width: 1, height: null, style: 'y' }, { src: 'https://i.test/a.gif', width: '2', height: '2', style: '' }]
      })
    )
    expect(facts).toEqual({
      links: [{ href: 'https://a.test', text: 'a' }],
      images: [
        { src: 'x', width: null, height: null, style: 'y' },
        { src: 'https://i.test/a.gif', width: '2', height: '2', style: '' }
      ]
    })
  })

  it('cuts what is too long to be anything but an attack on the memory', () => {
    const long = 'x'.repeat(10000)
    const facts = factsOf(page({ links: [{ href: `https://a.test/${long}`, text: long }] }))
    expect(facts?.links[0].href.length).toBe(2000)
    expect(facts?.links[0].text.length).toBe(300)
  })

  it('takes the height of the page, and no more than a page may have', () => {
    expect(parsePageMessage(JSON.stringify({ kind: 'height', height: 640 }))).toEqual({ kind: 'height', height: 640 })
    expect(parsePageMessage(JSON.stringify({ kind: 'height', height: 10_000_000 }))).toEqual({ kind: 'height', height: MAX_PAGE_HEIGHT })
    expect(parsePageMessage(JSON.stringify({ kind: 'height', height: -5 }))).toEqual({ kind: 'height', height: 0 })
  })

  it('takes no height that is not a number', () => {
    expect(parsePageMessage(JSON.stringify({ kind: 'height', height: '640' }))).toBeNull()
    expect(parsePageMessage(JSON.stringify({ kind: 'height' }))).toBeNull()
    expect(parsePageMessage('{"kind":"height","height":1e999}')).toBeNull()
  })
})
