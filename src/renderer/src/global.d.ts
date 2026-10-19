import type { JSX as ReactJSX } from 'react'

// @types/react 19 moved the JSX namespace under React.JSX and no longer puts it in the
// global scope, so every component's `: JSX.Element` return type needs this back.
declare global {
  namespace JSX {
    type Element = ReactJSX.Element
  }
}
