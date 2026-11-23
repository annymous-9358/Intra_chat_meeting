package app.intrachat.mobile

import android.content.Intent
import androidx.core.content.ContextCompat
import com.capacitorjs.plugins.pushnotifications.MessagingService
import com.google.firebase.messaging.RemoteMessage

/**
 * Receives Firebase messages. "walkie" messages (someone started talking) start the native walkie-talkie
 * player when the app is closed or in the background without the walkie-talkie open; everything else goes to
 * the normal push-notification handling.
 */
class IntraMessagingService : MessagingService() {
    override fun onMessageReceived(remoteMessage: RemoteMessage) {
        val d = remoteMessage.data
        if (d["type"] == "walkie") {
            // The app is on screen, or its own walkie-talkie is already listening: it plays the audio itself.
            if (MainActivity.visible || WalkieService.running || WalkieListenService.running) return
            if (!AuthPrefs(this).ready) return
            val i = Intent(this, WalkieListenService::class.java)
                .putExtra("room", d["room"])
                .putExtra("name", d["name"])
                .putExtra("title", d["title"])
                .putExtra("at", d["at"]?.toLongOrNull() ?: System.currentTimeMillis())
            try { ContextCompat.startForegroundService(this, i) } catch (_: Exception) { /* not allowed right now */ }
            return
        }
        super.onMessageReceived(remoteMessage)
    }
}
