import { useTranslation } from 'react-i18next'
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'
import { useToastStore } from '@renderer/state/toastStore'

const icons = {
  info: Info,
  success: CheckCircle2,
  error: AlertCircle
}

/** Renders the toast stack. Mounted once at the app root so every view can raise messages. */
function ToastHost(): JSX.Element | null {
  const { t } = useTranslation()
  const { toasts, dismiss } = useToastStore()

  if (toasts.length === 0) return null

  return (
    <div className="toast-host" role="status" aria-live="polite">
      {toasts.map((toast) => {
        const Icon = icons[toast.kind]
        return (
          <div className={`toast toast-${toast.kind}`} key={toast.id}>
            <Icon size={15} strokeWidth={1.75} />
            <span className="toast-message">{toast.message}</span>
            {toast.action && (
              <button
                className="toast-action"
                onClick={() => {
                  dismiss(toast.id)
                  void toast.action?.run()
                }}
              >
                {toast.action.label}
              </button>
            )}
            <button
              className="toast-close"
              onClick={() => dismiss(toast.id)}
              aria-label={t('compose.cancel')}
            >
              <X size={13} strokeWidth={1.75} />
            </button>
          </div>
        )
      })}
    </div>
  )
}

export default ToastHost
