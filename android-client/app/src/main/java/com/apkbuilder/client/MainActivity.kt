package com.apkbuilder.client

import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Bundle
import android.os.Environment
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast

/**
 * Phone remote for the APK & EXE Maker desktop app: upload a zip from your phone, watch the build,
 * download the finished APK/EXE. Shows a connect screen first (address + PIN from the desktop app).
 */
class MainActivity : Activity() {

    private val bg = Color.parseColor("#0B1020")
    private val card = Color.parseColor("#121A30")
    private val ink = Color.parseColor("#E2E8F0")
    private val muted = Color.parseColor("#94A3B8")
    private val indigo = Color.parseColor("#818CF8")
    private val sky = Color.parseColor("#38BDF8")

    private lateinit var root: FrameLayout
    private var web: WebView? = null
    private var fileCallback: ValueCallback<Array<Uri>>? = null

    private fun prefs() = getSharedPreferences("client", Context.MODE_PRIVATE)
    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        root = FrameLayout(this).apply { setBackgroundColor(bg) }
        setContentView(root)
        val server = prefs().getString("server", "") ?: ""
        if (server.isEmpty()) showConnect(null) else showWeb(server, prefs().getString("pin", "") ?: "")
    }

    // ---------------- Connect screen ----------------
    private fun rounded(color: Int, r: Int) = GradientDrawable().apply { setColor(color); cornerRadius = dp(r).toFloat() }

    private fun showConnect(error: String?) {
        web?.destroy(); web = null
        root.removeAllViews()
        val col = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(22), dp(24), dp(22), dp(24))
            background = rounded(card, 24)
        }
        fun tv(t: String, size: Float, color: Int = ink, bold: Boolean = false) = TextView(this).apply {
            text = t; textSize = size; setTextColor(color); if (bold) setTypeface(typeface, Typeface.BOLD)
            setPadding(0, dp(3), 0, dp(3))
        }
        fun field(hint: String, type: Int) = EditText(this).apply {
            this.hint = hint; inputType = type; setSingleLine(true)
            setTextColor(ink); setHintTextColor(Color.parseColor("#64748B"))
            background = rounded(bg, 14); setPadding(dp(14), dp(12), dp(14), dp(12))
        }
        col.addView(tv("APK & EXE MAKER", 12f, indigo, true))
        col.addView(tv("Connect to your PC", 24f, ink, true))
        col.addView(tv("Open the desktop app on your PC. It shows an address and a PIN — enter them here (same Wi‑Fi).", 14f, muted))
        val url = field("Address  (http://192.168.1.10:4317)", InputType.TYPE_TEXT_VARIATION_URI)
        url.setText(prefs().getString("server", ""))
        val pin = field("PIN", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS)
        pin.setText(prefs().getString("pin", ""))
        col.addView(url, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(14) })
        col.addView(pin, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(10) })
        val err = tv(error ?: "", 13f, Color.parseColor("#FCA5A5"))
        col.addView(err)
        val go = Button(this).apply {
            text = "Connect"; isAllCaps = false; textSize = 16f; setTypeface(typeface, Typeface.BOLD)
            stateListAnimator = null; setTextColor(Color.parseColor("#06101F"))
            background = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, intArrayOf(indigo, sky)).apply { cornerRadius = dp(16).toFloat() }
            setOnClickListener {
                var u = url.text.toString().trim().trimEnd('/')
                if (u.isNotEmpty() && !u.startsWith("http")) u = "http://$u"
                if (u.isEmpty()) { err.text = "Enter the address shown in the desktop app"; return@setOnClickListener }
                prefs().edit().putString("server", u).putString("pin", pin.text.toString().trim()).apply()
                showWeb(u, pin.text.toString().trim())
            }
        }
        col.addView(go, LinearLayout.LayoutParams(-1, dp(52)).apply { topMargin = dp(14) })
        root.addView(col, FrameLayout.LayoutParams(-1, -2, Gravity.CENTER).apply { setMargins(dp(18), dp(18), dp(18), dp(18)) })
    }

    // ---------------- Web view ----------------
    @SuppressLint("SetJavaScriptEnabled")
    private fun showWeb(server: String, pin: String) {
        root.removeAllViews()
        val bar = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply { max = 100 }
        val w = WebView(this).apply {
            setBackgroundColor(bg)
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            CookieManager.getInstance().setAcceptCookie(true)
            webViewClient = object : WebViewClient() {
                override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                    if (request.isForMainFrame) showConnect("Could not reach $server. Is the desktop app running on the same Wi‑Fi?")
                }
            }
            webChromeClient = object : WebChromeClient() {
                override fun onProgressChanged(view: WebView?, p: Int) {
                    bar.progress = p
                    bar.visibility = if (p >= 100) View.GONE else View.VISIBLE
                }
                override fun onShowFileChooser(v: WebView, cb: ValueCallback<Array<Uri>>, p: FileChooserParams): Boolean {
                    fileCallback?.onReceiveValue(null)
                    fileCallback = cb
                    val i = Intent(Intent.ACTION_GET_CONTENT).apply { addCategory(Intent.CATEGORY_OPENABLE); type = "*/*" }
                    return try { startActivityForResult(Intent.createChooser(i, "Choose a .zip"), 7); true }
                    catch (e: Exception) { fileCallback = null; false }
                }
            }
            setDownloadListener { url, ua, cd, mime, _ ->
                val name = URLUtil.guessFileName(url, cd, mime)
                val req = DownloadManager.Request(Uri.parse(url))
                    .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                    .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name)
                    .setTitle(name).setMimeType(mime)
                    .addRequestHeader("Cookie", CookieManager.getInstance().getCookie(url) ?: "")
                    .addRequestHeader("User-Agent", ua)
                (getSystemService(DOWNLOAD_SERVICE) as DownloadManager).enqueue(req)
                Toast.makeText(this@MainActivity, "Downloading $name — open it from Downloads to install", Toast.LENGTH_LONG).show()
            }
            loadUrl(if (pin.isNotEmpty()) "$server/?pin=${Uri.encode(pin)}" else server)
        }
        web = w
        root.addView(w, FrameLayout.LayoutParams(-1, -1))
        root.addView(bar, FrameLayout.LayoutParams(-1, dp(3)))
        // Small settings button (bottom-right) to change the PC address.
        val gear = TextView(this).apply {
            text = "⚙"; textSize = 20f; setTextColor(ink); gravity = Gravity.CENTER
            background = rounded(Color.parseColor("#CC121A30"), 22)
            setOnClickListener {
                AlertDialog.Builder(this@MainActivity).setTitle("Connection")
                    .setMessage(server)
                    .setPositiveButton("Change PC / PIN") { _, _ -> showConnect(null) }
                    .setNegativeButton("Reload") { _, _ -> w.reload() }.show()
            }
        }
        root.addView(gear, FrameLayout.LayoutParams(dp(44), dp(44), Gravity.BOTTOM or Gravity.END).apply { setMargins(0, 0, dp(14), dp(14)) })
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode == 7) {
            val uri = if (resultCode == RESULT_OK) data?.data else null
            fileCallback?.onReceiveValue(if (uri != null) arrayOf(uri) else null)
            fileCallback = null
        } else super.onActivityResult(requestCode, resultCode, data)
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        val w = web
        if (w != null && w.canGoBack()) w.goBack() else super.onBackPressed()
    }
}
