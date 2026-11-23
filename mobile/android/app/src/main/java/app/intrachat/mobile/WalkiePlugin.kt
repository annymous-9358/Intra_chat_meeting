package app.intrachat.mobile

import android.content.Intent
import androidx.core.content.ContextCompat
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * JS: Capacitor.nativePromise('Walkie', 'start', { title, text }) / ('Walkie', 'stop')
 *     Capacitor.addListener('Walkie', 'stop', cb)  — fired when the person taps Stop in the notification.
 */
@CapacitorPlugin(name = "Walkie")
class WalkiePlugin : Plugin() {
    override fun load() { instance = this }

    @PluginMethod
    fun start(call: PluginCall) {
        context.stopService(Intent(context, WalkieListenService::class.java))   // the app takes over from the closed-app player
        val i = Intent(context, WalkieService::class.java)
            .putExtra("title", call.getString("title") ?: "Walkie-talkie on")
            .putExtra("text", call.getString("text") ?: "Listening — you’ll hear people live")
        try { ContextCompat.startForegroundService(context, i); call.resolve() }
        catch (e: Exception) { call.reject("Couldn’t keep the walkie-talkie running: ${e.message}") }
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        context.stopService(Intent(context, WalkieService::class.java))
        call.resolve()
    }

    /** Remember who we are, so the app can play the walkie-talkie even when it's closed. */
    @PluginMethod
    fun configure(call: PluginCall) {
        val base = call.getString("baseUrl"); val token = call.getString("token")
        if (base.isNullOrBlank() || !base.startsWith("https://") || token.isNullOrBlank()) { call.reject("baseUrl (https) and token are required"); return }
        AuthPrefs(context).apply { baseUrl = base.trimEnd('/'); this.token = token; device = call.getString("device") }
        call.resolve()
    }

    @PluginMethod
    fun clear(call: PluginCall) {
        AuthPrefs(context).clear()
        context.stopService(Intent(context, WalkieListenService::class.java))
        call.resolve()
    }

    /** Chat opened from a "… is talking" notification while the app was closed. */
    @PluginMethod
    fun takePending(call: PluginCall) {
        val r = MainActivity.pendingRoom; MainActivity.pendingRoom = null
        call.resolve(JSObject().put("room", r))
    }

    fun emitStop() { notifyListeners("stop", JSObject(), true) }

    companion object { @Volatile var instance: WalkiePlugin? = null }
}
