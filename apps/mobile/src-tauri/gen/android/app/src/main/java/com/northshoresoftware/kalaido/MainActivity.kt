package com.northshoresoftware.kalaido

import android.graphics.Color
import android.os.Bundle
import android.webkit.WebView
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import java.util.Locale

class MainActivity : TauriActivity() {
  private var lastInsetsJs: String? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge(
      statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
      navigationBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
    )
    super.onCreate(savedInstanceState)
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    ViewCompat.setOnApplyWindowInsetsListener(webView) { view, windowInsets ->
      val bars = windowInsets.getInsets(
        WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout(),
      )
      val ime = windowInsets.getInsets(WindowInsetsCompat.Type.ime())
      val density = view.resources.displayMetrics.density.coerceAtLeast(1f)

      val top = fmtCssPx(bars.top / density)
      val right = fmtCssPx(bars.right / density)
      val bottom = fmtCssPx(maxOf(0, bars.bottom - ime.bottom) / density)
      val left = fmtCssPx(bars.left / density)
      val imeBottom = fmtCssPx(ime.bottom / density)

      val js = """
        (function applyInsets() {
          var el = document.documentElement;
          if (!el) { requestAnimationFrame(applyInsets); return; }
          var s = el.style;
          s.setProperty('--safe-area-top', '${top}px');
          s.setProperty('--safe-area-right', '${right}px');
          s.setProperty('--safe-area-bottom', '${bottom}px');
          s.setProperty('--safe-area-left', '${left}px');
          el.dataset.androidIme = '${imeBottom}';
          window.dispatchEvent(new Event('kalaido:insets'));
        })();
      """.trimIndent()

      lastInsetsJs = js
      webView.evaluateJavascript(js, null)
      ViewCompat.onApplyWindowInsets(view, windowInsets)
    }
  }

  override fun onWebViewHistoryChanged(webView: WebView) {
    super.onWebViewHistoryChanged(webView)
    lastInsetsJs?.let { webView.evaluateJavascript(it, null) }
    ViewCompat.requestApplyInsets(webView)
  }

  private fun fmtCssPx(value: Float): String =
    String.format(Locale.US, "%.2f", value)
}
