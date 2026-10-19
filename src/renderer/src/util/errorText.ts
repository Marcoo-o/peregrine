import i18next from '@renderer/i18n'
import { isAppErrorCode, parseErrorCode, plainErrorMessage } from '@peregrine/core/errorText'

/**
 * The sentence to show for a failure. Translated when the main process named a cause.
 *
 * Deliberately not a hook. Errors are caught in stores, in event handlers and in `toastError`,
 * none of which can call `useTranslation`; going through the i18next instance directly means
 * one rule for the whole application instead of translated text wherever a component happened
 * to be handy and raw text everywhere else.
 *
 * Anything not in the code list is shown as it is, minus the IPC scaffolding: it comes from a
 * library or a server and is still better than "something went wrong".
 */
export function errorText(err: unknown): string {
  const parsed = parseErrorCode(err)
  if (parsed && isAppErrorCode(parsed.code)) {
    return i18next.t(`errors.${parsed.code}`, { detail: parsed.detail ?? '' })
  }
  return plainErrorMessage(err)
}
