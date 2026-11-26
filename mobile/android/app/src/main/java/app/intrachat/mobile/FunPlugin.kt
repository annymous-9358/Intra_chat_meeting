package app.intrachat.mobile

import android.app.WallpaperManager
import android.content.ComponentName
import android.content.Intent
import androidx.activity.result.ActivityResult
import com.getcapacitor.annotation.ActivityCallback
import java.io.File
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Base64
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.atomic.AtomicLong

/**
 * Fun mode: friends set this phone's lock / home screen wallpaper (a photo, or a doodle that updates while they draw).
 * JS: Capacitor.nativePromise('Fun', 'setAllowed', { lock, home, baseUrl })   what this phone accepts (the user's choice)
 *     Capacitor.nativePromise('Fun', 'restore', { target: 'lock' | 'home' })   lock screen back to the home wallpaper /
 *                                                                              home screen back to the phone's default
 *     Capacitor.nativePromise('Fun', 'setOwn', { data: base64Jpeg, target })    use one of your own photos
 *     Capacitor.nativePromise('Fun', 'liveStatus')                             → { active } is the live wallpaper on
 *     Capacitor.nativePromise('Fun', 'setLive')                                opens Android's "Set wallpaper" for it → { active }
 * Pictures arrive as a data push (type "fun") handled by IntraMessagingService → FunWallpaper.fromPush.
 */
@CapacitorPlugin(name = "Fun")
class FunPlugin : Plugin() {
    @PluginMethod
    fun setAllowed(call: PluginCall) {
        FunPrefs(context).apply {
            lock = call.getBoolean("lock", false) == true
            home = call.getBoolean("home", false) == true
            call.getString("baseUrl")?.takeIf { it.startsWith("https://") }?.let { base = it.trimEnd('/') }
            call.getString("token")?.let { token = it }
            call.getString("device")?.let { device = it }
        }
        call.resolve(JSObject().put("live", IntraWallpaperService.isActive(context)))
    }

    @PluginMethod
    fun liveStatus(call: PluginCall) { call.resolve(JSObject().put("active", IntraWallpaperService.isActive(context))) }

    /** Android's own "Set wallpaper" screen for the live wallpaper (the person confirms there). */
    @PluginMethod
    fun setLive(call: PluginCall) {
        if (IntraWallpaperService.isActive(context)) { call.resolve(JSObject().put("active", true)); return }
        val i = Intent(WallpaperManager.ACTION_CHANGE_LIVE_WALLPAPER)
            .putExtra(WallpaperManager.EXTRA_LIVE_WALLPAPER_COMPONENT, ComponentName(context, IntraWallpaperService::class.java))
        try { startActivityForResult(call, i, "liveResult") }
        catch (e: Exception) { call.reject("This phone can’t set live wallpapers: ${e.message}") }
    }

    @ActivityCallback
    private fun liveResult(call: PluginCall?, result: ActivityResult) {
        val on = IntraWallpaperService.isActive(context)
        // a separate lock-screen picture would hide it on the lock screen: let the lock screen follow the live wallpaper
        if (on) try { WallpaperManager.getInstance(context).clear(WallpaperManager.FLAG_LOCK) } catch (_: Exception) { }
        call?.resolve(JSObject().put("active", on))
    }

    @PluginMethod
    fun restore(call: PluginCall) {
        if (IntraWallpaperService.isActive(context)) { FunBus.mine(context); call.resolve(); return }   // live wallpaper: back to your own photo
        try {
            val wm = WallpaperManager.getInstance(context)
            if (call.getString("target") == "home") wm.clear(WallpaperManager.FLAG_SYSTEM) else wm.clear(WallpaperManager.FLAG_LOCK)
            call.resolve()
        } catch (e: Exception) { call.reject("Couldn’t change the wallpaper: ${e.message}") }
    }

    @PluginMethod
    fun setOwn(call: PluginCall) {
        val data = call.getString("data") ?: return call.reject("No picture")
        try {
            val bytes = Base64.decode(data.substringAfter(","), Base64.DEFAULT)
            if (IntraWallpaperService.isActive(context)) { File(context.filesDir, "fun_default.jpg").writeBytes(bytes); FunBus.mine(context) }   // what the live wallpaper shows when nothing's sent
            else FunWallpaper.apply(context, bytes, call.getString("target") ?: "lock")
            call.resolve()
        } catch (e: Exception) { call.reject("Couldn’t set that picture: ${e.message}") }
    }
}

class FunPrefs(ctx: Context) {
    private val p = ctx.getSharedPreferences("intra_fun", Context.MODE_PRIVATE)
    var lock: Boolean get() = p.getBoolean("lock", false); set(v) { p.edit().putBoolean("lock", v).apply() }
    var home: Boolean get() = p.getBoolean("home", false); set(v) { p.edit().putBoolean("home", v).apply() }
    var base: String? get() = p.getString("base", null); set(v) { p.edit().putString("base", v).apply() }
    var token: String? get() = p.getString("token", null); set(v) { p.edit().putString("token", v).apply() }
    var device: String? get() = p.getString("device", null); set(v) { p.edit().putString("device", v).apply() }
    // what the live wallpaper shows: kind (photo / video / doodle), the picture or video, and a doodle's chat + id
    var itemKind: String? get() = p.getString("item_kind", null); set(v) { p.edit().putString("item_kind", v).apply() }
    var itemUrl: String? get() = p.getString("item_url", null); set(v) { p.edit().putString("item_url", v).apply() }
    var itemSid: String? get() = p.getString("item_sid", null); set(v) { p.edit().putString("item_sid", v).apply() }
    var itemRoom: String? get() = p.getString("item_room", null); set(v) { p.edit().putString("item_room", v).apply() }
}

object FunWallpaper {
    private val newest = AtomicLong(0)      // live doodles send frames quickly: never let an older frame win

    /** A "fun" data push: download the picture and set it — only where this phone allows it. Runs on FCM's worker thread. */
    fun fromPush(ctx: Context, d: Map<String, String>) {
        val prefs = FunPrefs(ctx)
        val live = IntraWallpaperService.isActive(ctx)
        if (d["type"] == "fun-live") {             // a friend started a doodle: the live wallpaper follows it as it's drawn
            val room = d["room"]; val sid = d["sid"]
            if (live && (prefs.lock || prefs.home) && room != null && sid != null && Regex("^[a-z0-9]{8,24}$").matches(sid)) FunBus.live(ctx, room, sid)
            return
        }
        val want = d["target"] ?: "lock"
        val lock = (want == "lock" || want == "both") && prefs.lock
        val home = (want == "home" || want == "both") && prefs.home
        if (!lock && !home) return
        val path = d["url"] ?: return
        if (!Regex("^/api/file/[a-f0-9]{24}$").matches(path)) return
        val kind = d["kind"] ?: "photo"
        if (live) { FunBus.show(ctx, kind, path, d["sid"]?.takeIf { it.isNotEmpty() }, d["room"]); return }   // instant, no wallpaper swap
        val base = prefs.base ?: AuthPrefs(ctx).baseUrl ?: return
        val at = d["at"]?.toLongOrNull() ?: System.currentTimeMillis()
        if (at < newest.get()) return
        val bytes = download("$base$path") ?: return
        if (at < newest.get()) return
        newest.set(at)
        val target = if (lock && home) "both" else if (lock) "lock" else "home"
        if (kind == "video") { videoFrame(ctx, bytes)?.let { setBitmap(ctx, it, target) }; return }   // no live wallpaper: a still from the video
        apply(ctx, bytes, target)
    }

    /** A frame from about one second into a video (for phones without the live wallpaper). */
    private fun videoFrame(ctx: Context, bytes: ByteArray): Bitmap? {
        val f = java.io.File(ctx.cacheDir, "fun-video.tmp")
        return try {
            f.writeBytes(bytes)
            val r = android.media.MediaMetadataRetriever()
            try { r.setDataSource(f.absolutePath); r.getFrameAtTime(1_000_000, android.media.MediaMetadataRetriever.OPTION_CLOSEST_SYNC) ?: r.frameAtTime }
            finally { r.release() }
        } catch (_: Exception) { null } finally { f.delete() }
    }

    fun apply(ctx: Context, bytes: ByteArray, target: String) {
        val bmp = decode(ctx, bytes) ?: return
        setBitmap(ctx, bmp, target)
    }

    private fun setBitmap(ctx: Context, bmp: Bitmap, target: String) {
        val flags = when (target) {
            "home" -> WallpaperManager.FLAG_SYSTEM
            "both" -> WallpaperManager.FLAG_SYSTEM or WallpaperManager.FLAG_LOCK
            else -> WallpaperManager.FLAG_LOCK
        }
        WallpaperManager.getInstance(ctx).setBitmap(bmp, null, true, flags)
    }

    private fun download(url: String): ByteArray? = try {
        val c = URL(url).openConnection() as HttpURLConnection
        c.connectTimeout = 5000; c.readTimeout = 30000
        if (c.responseCode != 200) null else c.inputStream.use { it.readBytes() }.takeIf { it.size in 1..(21 * 1024 * 1024) }      // videos are up to 20 MB
    } catch (_: Exception) { null }

    // Decode at about screen size (big photos would waste memory)
    private fun decode(ctx: Context, bytes: ByteArray): Bitmap? {
        val dm = ctx.resources.displayMetrics
        val target = maxOf(dm.widthPixels, dm.heightPixels).coerceAtLeast(1280)
        val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, o)
        var sample = 1
        while (maxOf(o.outWidth, o.outHeight) / (sample * 2) >= target) sample *= 2
        return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
    }
}
