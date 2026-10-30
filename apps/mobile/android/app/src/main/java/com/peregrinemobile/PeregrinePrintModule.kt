package com.peregrinemobile

import android.content.Context
import android.print.PrintAttributes
import android.print.PrintManager
import android.webkit.WebView
import android.webkit.WebViewClient
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * Printing a page, and with it making a PDF of it: the system's print service has both, and "save as PDF" is one of the printers it offers.
 *
 * The page is a message, which is somebody else's HTML. It is drawn in a web view of its own that runs no script, reads no file of the application and fetches nothing
 * from the network, so printing a message is as harmless as reading it.
 */
class PeregrinePrintModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {

  /** The web view that is being printed from, held until the system has taken the page: a view nobody refers to is collected, and the page goes with it. */
  private var drawing: WebView? = null

  override fun getName() = "PeregrinePrint"

  /** Draws the HTML and hands it to the print service under the name of the job. Resolves once the service has the page, and not when it has printed it. */
  @ReactMethod
  fun print(jobName: String, html: String, promise: Promise) {
    val activity = reactApplicationContext.currentActivity
    if (activity == null) {
      promise.reject("E_NO_ACTIVITY", "There is no screen to print from")
      return
    }
    activity.runOnUiThread {
      try {
        val view = WebView(activity)
        view.settings.javaScriptEnabled = false
        view.settings.allowFileAccess = false
        view.settings.allowContentAccess = false
        view.settings.blockNetworkLoads = true
        var handed = false
        view.webViewClient =
          object : WebViewClient() {
            override fun onPageFinished(page: WebView, url: String?) {
              // A load can be reported more than once, and only the first is the page.
              if (handed) return
              handed = true
              val printing = activity.getSystemService(Context.PRINT_SERVICE) as PrintManager
              printing.print(jobName, page.createPrintDocumentAdapter(jobName), PrintAttributes.Builder().build())
              promise.resolve(null)
            }
          }
        drawing = view
        view.loadDataWithBaseURL(null, html, "text/html", "utf-8", null)
      } catch (e: RuntimeException) {
        promise.reject("E_PRINT", e.message ?: "The page could not be printed", e)
      }
    }
  }
}
