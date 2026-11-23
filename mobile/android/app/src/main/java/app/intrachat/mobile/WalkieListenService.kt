package app.intrachat.mobile

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.exoplayer.ExoPlayer
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/**
 * Plays the walkie-talkie live when Intra Chat is closed (woken by a Firebase "walkie" message).
 * Polls the room's live audio pieces from the server and plays them in order, then stops a few seconds
 * after the person finishes talking. Shows "Asha is talking · Ops" with Stop; tapping opens the chat.
 */
class WalkieListenService : Service() {
    private val main = Handler(Looper.getMainLooper())
    private val net = Executors.newSingleThreadExecutor()
    private var player: ExoPlayer? = null
    private var wake: PowerManager.WakeLock? = null
    private var room = ""
    private var title = ""
    private var tsince = 0L
    private var lastAudioAt = 0L
    private var startedAt = 0L
    private var speaker = ""
    private val played = HashSet<String>()
    private var stopped = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) { finish(); return START_NOT_STICKY }
        val r = intent?.getStringExtra("room") ?: run { stopSelf(); return START_NOT_STICKY }
        speaker = intent.getStringExtra("name") ?: "Someone"
        if (running && r == room) return START_NOT_STICKY        // already playing this room
        room = r
        title = intent.getStringExtra("title") ?: "Walkie-talkie"
        tsince = (intent.getLongExtra("at", System.currentTimeMillis())) - 3000
        startedAt = System.currentTimeMillis(); lastAudioAt = startedAt
        running = true; stopped = false
        ServiceCompat.startForeground(this, NOTIF_ID, notification(),
            if (Build.VERSION.SDK_INT >= 29) ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK else 0)
        wake = (getSystemService(Context.POWER_SERVICE) as PowerManager)
            .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "IntraChat:walkieListen").apply { setReferenceCounted(false); acquire(5 * 60 * 1000L) }
        if (player == null) player = ExoPlayer.Builder(this).build().apply {
            setAudioAttributes(AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_SPEECH).build(), true)
            playWhenReady = true
        }
        poll()
        return START_NOT_STICKY
    }

    private fun poll() {
        if (stopped) return
        val auth = AuthPrefs(this)
        val base = auth.baseUrl; val token = auth.token
        if (base == null || token == null) { finish(); return }
        net.execute {
            var floorName: String? = null
            val urls = ArrayList<String>()
            try {
                val conn = (URL("$base/api/talk/feed").openConnection() as HttpURLConnection).apply {
                    requestMethod = "POST"; connectTimeout = 8000; readTimeout = 8000; doOutput = true
                    setRequestProperty("Content-Type", "application/json")
                    setRequestProperty("Authorization", "Bearer $token")
                    auth.device?.let { setRequestProperty("X-Chat-Device", it) }
                }
                conn.outputStream.use { it.write(JSONObject().put("room", room).put("tsince", tsince).toString().toByteArray()) }
                if (conn.responseCode == 200) {
                    val d = JSONObject(conn.inputStream.bufferedReader().readText())
                    floorName = d.optJSONObject("floor")?.optString("name")
                    val chunks = d.optJSONArray("chunks")
                    if (chunks != null) for (i in 0 until chunks.length()) {
                        val c = chunks.getJSONObject(i)
                        val id = c.optString("talkId") + ":" + c.optInt("seq")
                        tsince = maxOf(tsince, c.optLong("at"))
                        if (played.add(id)) urls.add(base + c.optString("url"))
                        c.optString("name").takeIf { it.isNotEmpty() }?.let { speaker = it }
                    }
                } else if (conn.responseCode == 401 || conn.responseCode == 403) { main.post { finish() }; return@execute }
                conn.disconnect()
            } catch (e: Exception) { Log.w(TAG, "feed failed: ${e.message}") }
            main.post {
                if (stopped) return@post
                val p = player ?: return@post
                if (urls.isNotEmpty()) {
                    for (u in urls) p.addMediaItem(MediaItem.fromUri(Uri.parse(u)))
                    if (p.playbackState == androidx.media3.common.Player.STATE_IDLE) p.prepare()
                    if (p.playbackState == androidx.media3.common.Player.STATE_ENDED) { p.seekToNextMediaItem(); p.prepare() }
                    p.play()
                    lastAudioAt = System.currentTimeMillis()
                    updateNotification()
                }
                val now = System.currentTimeMillis()
                val talking = floorName != null
                val playing = p.isPlaying || p.playbackState == androidx.media3.common.Player.STATE_BUFFERING
                // Stop 6 s after the talk ends and the audio has played out, or after 3 minutes in total
                if ((!talking && !playing && now - lastAudioAt > 6000) || now - startedAt > 180_000) finish()
                else main.postDelayed({ poll() }, 350)
            }
        }
    }

    private fun notification(): android.app.Notification {
        val nm = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null)
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "Walkie-talkie (app closed)", NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = "Shown while a walkie-talkie message plays with the app closed"; setSound(null, null)
            })
        val open = PendingIntent.getActivity(this, 2,
            Intent(this, MainActivity::class.java).setAction(Intent.ACTION_VIEW).putExtra("room", room)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val stop = PendingIntent.getService(this, 3, Intent(this, WalkieListenService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        return NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setColor(0xFF00A884.toInt())
            .setContentTitle("$speaker is talking")
            .setContentText("Walkie-talkie · $title")
            .setOngoing(true).setOnlyAlertOnce(true).setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setContentIntent(open)
            .addAction(0, "Stop", stop)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build()
    }
    private fun updateNotification() {
        try { getSystemService(NotificationManager::class.java).notify(NOTIF_ID, notification()) } catch (_: Exception) {}
    }

    private fun finish() {
        if (stopped) return
        stopped = true; running = false
        main.removeCallbacksAndMessages(null)
        try { player?.release() } catch (_: Exception) {}
        player = null
        try { wake?.takeIf { it.isHeld }?.release() } catch (_: Exception) {}
        stopSelf()
    }

    override fun onDestroy() { finish(); net.shutdownNow(); super.onDestroy() }

    companion object {
        @Volatile var running = false
        const val CHANNEL = "walkie_closed"
        const val NOTIF_ID = 4202
        const val ACTION_STOP = "app.intrachat.mobile.WALKIE_LISTEN_STOP"
        const val TAG = "IntraWalkieListen"
    }
}

/** Who the native parts act as (set by the web app after sign-in; cleared on sign-out). */
class AuthPrefs(ctx: Context) {
    private val p = ctx.getSharedPreferences("intra_auth", Context.MODE_PRIVATE)
    var baseUrl: String? get() = p.getString("base", null); set(v) { p.edit().putString("base", v).apply() }
    var token: String? get() = p.getString("token", null); set(v) { p.edit().putString("token", v).apply() }
    var device: String? get() = p.getString("device", null); set(v) { p.edit().putString("device", v).apply() }
    val ready get() = baseUrl != null && token != null
    fun clear() { p.edit().clear().apply() }
}
