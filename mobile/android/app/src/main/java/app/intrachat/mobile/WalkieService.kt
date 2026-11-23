package app.intrachat.mobile

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat

/**
 * Keeps Intra Chat running while the walkie-talkie is listening, with the screen off or another app open
 * (like a music player or Zello). Shows an ongoing "Walkie-talkie on" notification with a Stop button,
 * and holds a CPU + Wi-Fi lock so live audio keeps arriving.
 */
class WalkieService : Service() {
    private var wake: PowerManager.WakeLock? = null
    private var wifi: WifiManager.WifiLock? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        running = true
        if (intent?.action == ACTION_STOP) {
            WalkiePlugin.instance?.emitStop()       // tell the web app to close the walkie-talkie
            stopSelf()
            return START_NOT_STICKY
        }
        val title = intent?.getStringExtra("title") ?: "Walkie-talkie on"
        val text = intent?.getStringExtra("text") ?: "Listening — you’ll hear people live"
        ServiceCompat.startForeground(this, NOTIF_ID, notification(title, text),
            if (Build.VERSION.SDK_INT >= 29) ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK else 0)
        if (wake == null) wake = (getSystemService(Context.POWER_SERVICE) as PowerManager)
            .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "IntraChat:walkie").apply { setReferenceCounted(false); acquire(4 * 60 * 60 * 1000L) }
        if (wifi == null) wifi = (applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager)
            .createWifiLock(if (Build.VERSION.SDK_INT >= 29) WifiManager.WIFI_MODE_FULL_LOW_LATENCY else @Suppress("DEPRECATION") WifiManager.WIFI_MODE_FULL_HIGH_PERF, "IntraChat:walkie")
            .apply { setReferenceCounted(false); acquire() }
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        running = false
        try { wake?.takeIf { it.isHeld }?.release() } catch (_: Exception) {}
        try { wifi?.takeIf { it.isHeld }?.release() } catch (_: Exception) {}
        wake = null; wifi = null
        super.onDestroy()
    }

    override fun onTaskRemoved(rootIntent: Intent?) {      // app swiped away from recents: stop listening
        stopSelf()
        super.onTaskRemoved(rootIntent)
    }

    private fun notification(title: String, text: String): Notification {
        val nm = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null) {
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "Walkie-talkie", NotificationManager.IMPORTANCE_LOW).apply {
                description = "Shown while the walkie-talkie is listening in the background"
                setShowBadge(false)
            })
        }
        val open = PendingIntent.getActivity(this, 0,
            Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val stop = PendingIntent.getService(this, 1, Intent(this, WalkieService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        return NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setColor(0xFF00A884.toInt())
            .setContentTitle(title)
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setContentIntent(open)
            .addAction(0, "Stop", stop)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build()
    }

    companion object {
        @Volatile var running = false
        const val CHANNEL = "walkie"
        const val NOTIF_ID = 4201
        const val ACTION_STOP = "app.intrachat.mobile.WALKIE_STOP"
    }
}
