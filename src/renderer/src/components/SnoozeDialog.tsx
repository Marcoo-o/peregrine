import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Clock } from 'lucide-react'
import { parseCustomSnooze, resolveSnoozePreset, snoozeChoices } from '@peregrine/core/snooze'
import { useDialog } from '@renderer/util/useDialog'

interface SnoozeDialogProps {
  /** How many messages are being put aside; shown so a stray multi-selection is noticed. */
  count: number
  /** Overrides the heading; the same picker serves "remind me" and "send later". */
  title?: string
  onChoose: (until: number) => void
  onCancel: () => void
}

/** `datetime-local` wants `YYYY-MM-DDTHH:MM` in local time, which toISOString does not give. */
function toLocalInput(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * The presets are the feature.
 *
 * Putting a message aside is a two-second decision; a date picker as the first thing on
 * screen would cost more attention than reading the mail. The exact time is there for the
 * one case in ten that needs it, one click further in.
 */
function SnoozeDialog({ count, title, onChoose, onCancel }: SnoozeDialogProps): JSX.Element {
  const { t } = useTranslation()
  const panelRef = useDialog(onCancel)
  const now = new Date()
  const [custom, setCustom] = useState(false)
  const [value, setValue] = useState(() => toLocalInput(resolveSnoozePreset('tomorrow', now)))
  const firstRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    firstRef.current?.focus()
  }, [])

  const choices = snoozeChoices(now)
  const customTime = parseCustomSnooze(value, now)

  const formatTime = (date: Date): string =>
    new Intl.DateTimeFormat(undefined, {
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date)

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div
        className="modal-panel snooze-dialog"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="snooze-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id="snooze-title">
          <Clock size={15} /> {title ?? t('snooze.title', { count })}
        </h3>

        <div className="snooze-presets">
          {choices.map(({ preset, at }, index) => (
            <button
              key={preset}
              ref={index === 0 ? firstRef : undefined}
              className="snooze-preset"
              onClick={() => onChoose(at.getTime())}
            >
              <span>{t(`snooze.preset.${preset}`)}</span>
              <span className="snooze-when">{formatTime(at)}</span>
            </button>
          ))}
        </div>

        {custom ? (
          <div className="snooze-custom">
            <input
              type="datetime-local"
              value={value}
              min={toLocalInput(now)}
              autoFocus
              onChange={(event) => setValue(event.target.value)}
            />
            <button
              className="primary"
              disabled={customTime === null}
              onClick={() => customTime !== null && onChoose(customTime)}
            >
              {t('snooze.confirm')}
            </button>
          </div>
        ) : (
          <button className="snooze-preset snooze-custom-open" onClick={() => setCustom(true)}>
            {t('snooze.custom')}
          </button>
        )}

        <p className="snooze-hint">{t('snooze.localHint')}</p>

        <div className="modal-actions">
          <button onClick={onCancel}>{t('compose.cancel')}</button>
        </div>
      </div>
    </div>
  )
}

export default SnoozeDialog
