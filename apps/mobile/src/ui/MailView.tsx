import { useMemo, useState } from 'react'
import { PixelRatio } from 'react-native'
import { WebView } from 'react-native-webview'
import type { PageFacts } from '../reading/assessment'
import { buildMailDocument, PAGE_BACKGROUND } from '../reading/mailDocument'
import { MAIL_PAGE_SCRIPT, parsePageMessage } from '../reading/pageFacts'
import { useStyles } from './useStyles'

/** How tall the view is until the page has said how tall it is. */
const INITIAL_HEIGHT = 120

/**
 * The HTML of a message, as the sender wrote it, in a page where nothing of the message can run: the policy of
 * the page allows no script of it, no form to go anywhere and no image from outside until it is asked to, and
 * this view allows no file, no storage and no second window besides. The one script there is is ours, and
 * reports the links and images of the page and how tall it is. The view is as tall as the page, so that the
 * screen it is on scrolls as one and the message is not a small window in it. A link that is tapped does not
 * open here: it is handed to the application, which looks at it first.
 */
export function MailView(props: {
  html: string
  inlineImages: Record<string, string>
  allowRemoteImages: boolean
  onFacts: (facts: PageFacts) => void
  onLink: (url: string) => void
}) {
  const styles = useStyles()
  const [height, setHeight] = useState(INITIAL_HEIGHT)
  const { html, inlineImages, allowRemoteImages } = props
  const document = useMemo(
    () => buildMailDocument({ html, inlineImages, allowRemoteImages }),
    [html, inlineImages, allowRemoteImages]
  )
  return (
    <WebView
      style={[styles.mailView, { height, backgroundColor: PAGE_BACKGROUND }]}
      source={{ html: document }}
      // Everything is let through to `onShouldStartLoadWithRequest` below, which refuses it. An address that the
      // whitelist does not match is not refused by the view: it is opened with the system's own handler, at once,
      // and never reaches the check of the application.
      originWhitelist={['*']}
      injectedJavaScript={MAIL_PAGE_SCRIPT}
      scrollEnabled={false}
      nestedScrollEnabled={false}
      overScrollMode="never"
      onMessage={(event) => {
        const message = parsePageMessage(event.nativeEvent.data)
        if (message?.kind === 'page') props.onFacts(message.facts)
        else if (message?.kind === 'height') setHeight(Math.max(INITIAL_HEIGHT, message.height))
      }}
      onShouldStartLoadWithRequest={(request) => {
        // The page itself is loaded from `about:blank`; anything else is a link that was followed or a redirect.
        if (request.url === 'about:blank') return true
        props.onLink(request.url)
        return false
      }}
      textZoom={Math.round(PixelRatio.getFontScale() * 100)}
      allowFileAccess={false}
      allowFileAccessFromFileURLs={false}
      allowUniversalAccessFromFileURLs={false}
      allowsLinkPreview={false}
      domStorageEnabled={false}
      cacheEnabled={false}
      incognito
      thirdPartyCookiesEnabled={false}
      sharedCookiesEnabled={false}
      geolocationEnabled={false}
      mixedContentMode="never"
      setSupportMultipleWindows={false}
      javaScriptCanOpenWindowsAutomatically={false}
    />
  )
}
