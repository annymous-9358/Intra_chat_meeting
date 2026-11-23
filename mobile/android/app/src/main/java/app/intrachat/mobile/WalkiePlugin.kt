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

    fun emitStop() { notifyListeners("stop", JSObject(), true) }

    companion object { @Volatile var instance: WalkiePlugin? = null }
}
