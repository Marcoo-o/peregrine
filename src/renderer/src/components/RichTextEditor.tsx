import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import DOMPurify from 'dompurify'
import { askForText } from '@renderer/state/promptStore'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Baseline,
  Bold,
  Braces,
  Code,
  Highlighter,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  Quote,
  RemoveFormatting,
  Strikethrough,
  Underline
} from 'lucide-react'

interface RichTextEditorProps {
  html: string
  onChange: (html: string) => void
}

interface ToolButton {
  command: string
  value?: string
  labelKey: string
  icon: typeof Bold
}

/** Toolbar layout; a null entry draws a separator between groups. */
const BUTTONS: (ToolButton | null)[] = [
  { command: 'bold', labelKey: 'compose.bold', icon: Bold },
  { command: 'italic', labelKey: 'compose.italic', icon: Italic },
  { command: 'underline', labelKey: 'compose.underline', icon: Underline },
  { command: 'strikeThrough', labelKey: 'compose.strikethrough', icon: Strikethrough },
  null,
  { command: 'insertUnorderedList', labelKey: 'compose.bulletList', icon: List },
  { command: 'insertOrderedList', labelKey: 'compose.numberedList', icon: ListOrdered },
  { command: 'formatBlock', value: 'blockquote', labelKey: 'compose.quote', icon: Quote },
  null,
  { command: 'justifyLeft', labelKey: 'compose.alignLeft', icon: AlignLeft },
  { command: 'justifyCenter', labelKey: 'compose.alignCenter', icon: AlignCenter },
  { command: 'justifyRight', labelKey: 'compose.alignRight', icon: AlignRight },
  null,
  { command: 'insertHorizontalRule', labelKey: 'compose.horizontalRule', icon: Minus },
  { command: 'removeFormat', labelKey: 'compose.clearFormatting', icon: RemoveFormatting }
]

/** Heading levels offered; 'p' returns a block to ordinary text. */
const BLOCKS = ['p', 'h1', 'h2', 'h3'] as const

/** Strips markup so a text/plain alternative always ships alongside the HTML part. */
export function htmlToPlainText(html: string): string {
  const container = document.createElement('div')
  container.innerHTML = html
  container.querySelectorAll('br').forEach((br) => br.replaceWith('\n'))
  container.querySelectorAll('p, div, li, blockquote').forEach((block) => {
    block.append('\n')
  })
  return (container.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * contentEditable with execCommand. The API is formally deprecated, but it is the only
 * formatting engine every Chromium build ships, and pulling in a full editor framework for a
 * bold/italic/list toolbar would cost more than it returns.
 */
function RichTextEditor({ html, onChange }: RichTextEditorProps): JSX.Element {
  const { t } = useTranslation()
  const editorRef = useRef<HTMLDivElement>(null)

  /**
   * What this component last reported upwards.
   *
   * Writing the incoming value into the DOM on every render would reset the caret on each
   * keystroke, but never writing it means a change made elsewhere. Swapping the signature
   * when the sender changes. Would never appear. Remembering what was emitted tells the two
   * apart: anything else arriving is a change from outside and does belong in the DOM.
   */
  const lastEmitted = useRef<string>('')

  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    if (html === lastEmitted.current || html === editor.innerHTML) return
    editor.innerHTML = DOMPurify.sanitize(html)
  }, [html])

  function emit(value: string): void {
    lastEmitted.current = value
    onChange(value)
  }

  function apply(button: ToolButton): void {
    editorRef.current?.focus()
    document.execCommand(button.command, false, button.value)
    emit(editorRef.current?.innerHTML ?? '')
  }

  /**
   * Wraps the selection in an element execCommand has no command for.
   *
   * `insertHTML` replaces the selection, so the selected text has to be carried over by
   * hand. And escaped, or a selected "<" would become markup rather than a character.
   */
  function wrapSelection(before: string, after: string): void {
    editorRef.current?.focus()
    const selected = window.getSelection()?.toString() ?? ''
    const escaped = selected
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
    document.execCommand('insertHTML', false, `${before}${escaped}${after}`)
    emit(editorRef.current?.innerHTML ?? '')
  }

  function applyColor(command: 'foreColor' | 'hiliteColor', value: string): void {
    editorRef.current?.focus()
    // hiliteColor is what Firefox understands; Chromium wants backColor. Trying both costs
    // nothing, and the one that is not supported is simply ignored.
    if (!document.execCommand(command, false, value) && command === 'hiliteColor') {
      document.execCommand('backColor', false, value)
    }
    emit(editorRef.current?.innerHTML ?? '')
  }

  async function insertLink(): Promise<void> {
    // The selection has to be captured before the dialog opens: focus moves to its input,
    // and by the time an answer arrives there is nothing selected to turn into a link.
    const selection = window.getSelection()
    const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null

    const url = await askForText({ title: t('compose.linkPrompt'), placeholder: 'https://' })
    if (!url) return

    editorRef.current?.focus()
    if (range) {
      const restored = window.getSelection()
      restored?.removeAllRanges()
      restored?.addRange(range)
    }
    document.execCommand('createLink', false, url)
    emit(editorRef.current?.innerHTML ?? '')
  }

  return (
    <div className="rich-editor">
      <div className="rich-toolbar">
        <select
          className="rich-block-select"
          value=""
          title={t('compose.blockFormat')}
          aria-label={t('compose.blockFormat')}
          onMouseDown={(event) => event.stopPropagation()}
          onChange={(event) => {
            apply({ command: 'formatBlock', value: event.target.value, labelKey: '', icon: Bold })
            // Reset to the placeholder: the select reports what was just applied, not what the
            // caret currently sits in, and showing a stale value would be a lie.
            event.target.value = ''
          }}
        >
          <option value="" disabled>
            {t('compose.blockFormat')}
          </option>
          {BLOCKS.map((block) => (
            <option key={block} value={block}>
              {t(`compose.block.${block}`)}
            </option>
          ))}
        </select>

        {BUTTONS.map((button, index) =>
          button === null ? (
            <span key={`sep-${index}`} className="rich-toolbar-separator" />
          ) : (
            <button
              key={button.command + (button.value ?? '')}
              type="button"
              title={t(button.labelKey)}
              aria-label={t(button.labelKey)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => apply(button)}
            >
              {(() => {
                const Icon = button.icon
                return <Icon size={14} strokeWidth={1.75} />
              })()}
            </button>
          )
        )}

        <span className="rich-toolbar-separator" />

        {/* The colour input carries the swatch itself, so the icon sits on top of it as a
            label rather than next to a second control that means the same thing. */}
        <label className="rich-color" title={t('compose.textColor')}>
          <Baseline size={14} strokeWidth={1.75} />
          <input
            type="color"
            defaultValue="#1b1f24"
            onMouseDown={(event) => event.stopPropagation()}
            onChange={(event) => applyColor('foreColor', event.target.value)}
          />
        </label>
        <label className="rich-color" title={t('compose.highlightColor')}>
          <Highlighter size={14} strokeWidth={1.75} />
          <input
            type="color"
            defaultValue="#ffe066"
            onMouseDown={(event) => event.stopPropagation()}
            onChange={(event) => applyColor('hiliteColor', event.target.value)}
          />
        </label>

        <span className="rich-toolbar-separator" />

        <button
          type="button"
          title={t('compose.inlineCode')}
          aria-label={t('compose.inlineCode')}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => wrapSelection('<code>', '</code>')}
        >
          <Code size={14} strokeWidth={1.75} />
        </button>
        <button
          type="button"
          title={t('compose.codeBlock')}
          aria-label={t('compose.codeBlock')}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => wrapSelection('<pre><code>', '</code></pre><p><br></p>')}
        >
          <Braces size={14} strokeWidth={1.75} />
        </button>
        <button
          type="button"
          title={t('compose.link')}
          aria-label={t('compose.link')}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => void insertLink()}
        >
          <Link2 size={14} strokeWidth={1.75} />
        </button>
      </div>
      <div
        ref={editorRef}
        className="rich-surface"
        contentEditable
        role="textbox"
        aria-multiline="true"
        suppressContentEditableWarning
        onInput={(event) => emit(event.currentTarget.innerHTML)}
        // Paste as plain text: pasted markup from a browser drags along foreign styling that
        // then travels out with the mail.
        onPaste={(event) => {
          event.preventDefault()
          const text = event.clipboardData.getData('text/plain')
          document.execCommand('insertText', false, text)
          emit(event.currentTarget.innerHTML)
        }}
      />
    </div>
  )
}

export default RichTextEditor
