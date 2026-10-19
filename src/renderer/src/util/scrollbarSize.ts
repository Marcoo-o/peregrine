/**
 * Measures how wide a scrollbar actually is in this window and stores the result as a CSS
 * variable.
 *
 * The message list needs the number. Its header does not scroll, the body below it does, and
 * the header has to keep the same strip free. Otherwise the body is narrower by the bar's
 * width, and because the subject column takes the remainder, every fixed column below it
 * shifts by exactly that amount.
 *
 * Why measured rather than written down: the width used to be a number in the stylesheet, and
 * it was wrong twice. With `scrollbar-width: thin` it came to eleven pixels, without that
 * declaration seventeen, and the intent was ten. Measuring it means not having to know which
 * rule currently wins.
 *
 * The probe is created and removed immediately. Hidden elements have no dimensions, so
 * `visibility: hidden` is enough and `display: none` is not.
 */
export function measureScrollbarSize(): number {
  const probe = document.createElement('div')
  probe.style.cssText =
    'position:absolute;top:-9999px;width:100px;height:100px;overflow:scroll;visibility:hidden'
  document.body.appendChild(probe)
  const size = probe.offsetWidth - probe.clientWidth
  probe.remove()
  return size
}

/**
 * Called once at startup, after the stylesheet is in place.
 *
 * The width does not change while the application runs. It depends on the stylesheet and on the
 * system setting, and a change to the system does not restart the application anyway.
 */
export function applyScrollbarSize(): void {
  document.documentElement.style.setProperty('--scrollbar-size', `${measureScrollbarSize()}px`)
}
