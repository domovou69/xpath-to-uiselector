package io.github.domovou69.locatorlab

import android.app.Activity
import android.os.Build
import android.os.Bundle
import android.util.Base64
import android.util.Log
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import android.view.WindowInsets
import android.view.accessibility.AccessibilityNodeInfo
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.PopupWindow
import android.widget.Toast
import org.json.JSONArray
import org.json.JSONObject

// The oracle screen, rendered from JSON (audit/device/screens.js). Every node is one generic view whose
// accessibility node carries the attributes from JSON, so any class name or resource id renders without
// a rebuild:
//   c  className          (AccessibilityNodeInfo.setClassName; null = no class name)
//   id resource-id        (setViewIdResourceName)
//   t  text, d content-desc: absent = null, "" = empty
//   b  booleans: checkable checked clickable enabled focusable focused long-clickable scrollable selected
//      password (enabled defaults to true, the rest to false)
//   range  current value of a range widget (setRangeInfo)
//   k  children, row: lay children out side by side, w: weight along the parent's axis
//   hide: View.INVISIBLE
// The package name cannot be set this way: the framework overwrites it after the delegate runs.
// Top level: { root: node, popup?: node (a second window), toast?: "text" }.
// Start: am start -S -n io.github.domovou69.locatorlab/.LabActivity --es b64 <base64 of the JSON>
// Ready when logcat has "LocatorLab: ready <screen name>".
class LabActivity : Activity() {
    private var popup: PopupWindow? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val b64 = intent.getStringExtra("b64")
        val spec = if (b64 != null) JSONObject(String(Base64.decode(b64, Base64.DEFAULT), Charsets.UTF_8))
        else JSONObject().put("name", "empty").put("root", JSONObject().put("c", "android.widget.TextView").put("t", "LocatorLab"))
        val (w, h, pad) = contentArea()
        val frame = FrameLayout(this).apply {
            setPadding(pad[0], pad[1], pad[2], pad[3])
            isFocusableInTouchMode = true
        }
        frame.addView(build(spec.getJSONObject("root"), w, h), FrameLayout.LayoutParams(w, h))
        setContentView(frame)
        frame.requestFocus()
        val name = spec.optString("name", "?")
        window.decorView.viewTreeObserver.addOnDrawListener(object : ViewTreeObserver.OnDrawListener {
            var done = false
            override fun onDraw() {
                if (done) return
                done = true
                frame.post {
                    spec.optJSONObject("popup")?.let { p ->
                        val ph = h / 5
                        popup = PopupWindow(build(p, w, ph), w, ph, false).also { it.showAtLocation(frame, Gravity.BOTTOM, 0, 0) }
                    }
                    spec.optString("toast").takeIf { it.isNotEmpty() }?.let { Toast.makeText(this@LabActivity, it, Toast.LENGTH_LONG).show() }
                    frame.postDelayed({ Log.i("LocatorLab", "ready $name") }, 300)
                }
            }
        })
    }

    override fun onDestroy() {
        popup?.dismiss()
        super.onDestroy()
    }

    private fun contentArea(): Triple<Int, Int, IntArray> {
        if (Build.VERSION.SDK_INT >= 30) {
            val m = windowManager.currentWindowMetrics
            val i = m.windowInsets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
            return Triple(m.bounds.width() - i.left - i.right, m.bounds.height() - i.top - i.bottom, intArrayOf(i.left, i.top, i.right, i.bottom))
        }
        val d = resources.displayMetrics
        return Triple(d.widthPixels, d.heightPixels, intArrayOf(0, 0, 0, 0))
    }

    private fun build(n: JSONObject, w: Int, h: Int): View {
        val kids = n.optJSONArray("k") ?: JSONArray()
        val row = n.optBoolean("row")
        val v = LinearLayout(this).apply {
            orientation = if (row) LinearLayout.HORIZONTAL else LinearLayout.VERTICAL
            split(kids, if (row) w else h).forEachIndexed { i, len ->
                val (cw, ch) = if (row) len to h else w to len
                addView(build(kids.getJSONObject(i), cw, ch), ViewGroup.LayoutParams(cw, ch))
            }
        }
        if (n.optBoolean("hide")) v.visibility = View.INVISIBLE
        v.accessibilityDelegate = Attrs(n)
        return v
    }

    private fun split(kids: JSONArray, length: Int): List<Int> {
        val weights = (0 until kids.length()).map { kids.getJSONObject(it).optDouble("w", 1.0) }
        val sum = weights.sum().takeIf { it > 0 } ?: 1.0
        return weights.map { (length * it / sum).toInt() }
    }

    private class Attrs(val n: JSONObject) : View.AccessibilityDelegate() {
        override fun onInitializeAccessibilityNodeInfo(host: View, info: AccessibilityNodeInfo) {
            super.onInitializeAccessibilityNodeInfo(host, info)
            info.className = if (n.has("c")) (if (n.isNull("c")) null else n.getString("c")) else "android.view.View"
            if (n.has("id")) info.viewIdResourceName = n.getString("id")
            info.text = if (n.has("t")) n.getString("t") else null
            info.contentDescription = if (n.has("d")) n.getString("d") else null
            val b = n.optJSONObject("b") ?: JSONObject()
            info.isCheckable = b.optBoolean("checkable")
            @Suppress("DEPRECATION")
            info.isChecked = b.optBoolean("checked")
            info.isClickable = b.optBoolean("clickable")
            info.isEnabled = b.optBoolean("enabled", true)
            info.isFocusable = b.optBoolean("focusable")
            info.isFocused = b.optBoolean("focused")
            info.isLongClickable = b.optBoolean("long-clickable")
            info.isScrollable = b.optBoolean("scrollable")
            info.isSelected = b.optBoolean("selected")
            info.isPassword = b.optBoolean("password")
            if (n.has("range")) info.rangeInfo = AccessibilityNodeInfo.RangeInfo(
                AccessibilityNodeInfo.RangeInfo.RANGE_TYPE_FLOAT, 0f, 100f, n.getDouble("range").toFloat())
        }
    }
}
