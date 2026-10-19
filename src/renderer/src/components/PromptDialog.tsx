import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { usePromptStore, type PromptRequest } from '@renderer/state/promptStore'
import { useDialog } from '@renderer/util/useDialog'

interface PromptFormProps {
  request: PromptRequest
  onAnswer: (value: string | null) => void
}

/**
 * Split out and mounted with the request id as its key.
 *
 * The initial value has to be there on the very first render: focusing and selecting in an
 * effect that also *sets* the value would run against a field that still holds the previous
 * one, and the selection would be dropped by the render that follows.
 */
function PromptForm({ request, onAnswer }: PromptFormProps): JSX.Element {
  const { t } = useTranslation()
  // Registered here rather than one level up: this form is remounted per request, so the
  // handler lands on top of the stack for each one. Which is right when a prompt is opened
  // from inside another dialog, the case this whole stack exists for.
  const panelRef = useDialog(() => onAnswer(null))
  const [value, setValue] = useState(request.defaultValue ?? '')
  const fieldRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null)

  useEffect(() => {
    const field = fieldRef.current
    field?.focus()
    // Selected rather than placed at the end: a prefilled name is usually replaced, and when
    // it is not, one arrow key keeps it.
    field?.select()
  }, [])

  const submit = (): void => {
    const trimmed = value.trim()
    if (!trimmed) return
    onAnswer(trimmed)
  }

  /**
   * The default action has to be stopped, not just handled.
   *
   * Closing the dialog only removes the input; the key press carries on to whatever gets
   * focus next. With the link dialog that is the message editor, still holding the selection
   * the link was meant for. And an Enter there replaces it with a blank paragraph, which is
   * exactly the text being linked.
   */
  const handleKey = (event: React.KeyboardEvent, enterSubmits: boolean): void => {
    if (event.key === 'Enter' && enterSubmits) {
      event.preventDefault()
      submit()
    }
  }

  return (
    <div
      className="modal-panel prompt-dialog"
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="prompt-title"
      onClick={(event) => event.stopPropagation()}
    >
      <h3 id="prompt-title">{request.title}</h3>

      {request.multiline ? (
        <textarea
          ref={fieldRef}
          className="prompt-field prompt-field-multiline"
          value={value}
          placeholder={request.placeholder}
          onChange={(event) => setValue(event.target.value)}
          // Enter belongs to the text here.
          onKeyDown={(event) => handleKey(event, false)}
        />
      ) : (
        <input
          ref={fieldRef}
          className="prompt-field"
          type={request.secret ? 'password' : 'text'}
          value={value}
          placeholder={request.placeholder}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => handleKey(event, true)}
        />
      )}

      <div className="modal-actions">
        <button onClick={() => onAnswer(null)}>{t('compose.cancel')}</button>
        <button className="primary" disabled={value.trim() === ''} onClick={submit}>
          {request.confirmLabel ?? t('prompt.confirm')}
        </button>
      </div>
    </div>
  )
}

/**
 * The replacement for `window.prompt`, which Electron does not implement.
 *
 * Mounted once next to the toast host; anything that needs a line of text calls
 * `askForText` and awaits the answer.
 */
function PromptDialog(): JSX.Element | null {
  const request = usePromptStore((s) => s.request)
  const answer = usePromptStore((s) => s.answer)

  if (!request) return null

  return (
    <div className="modal-backdrop" onClick={() => answer(null)}>
      <PromptForm key={request.id} request={request} onAnswer={answer} />
    </div>
  )
}

export default PromptDialog
