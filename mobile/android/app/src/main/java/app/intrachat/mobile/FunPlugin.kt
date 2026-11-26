package app.intrachat.mobile

import android.app.WallpaperManager
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
        }
        call.resolve()
    }

    @PluginMethod
    fun restore(call: PluginCall) {
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
            FunWallpaper.apply(context, bytes, call.getString("target") ?: "lock")
            call.resolve()
        } catch (e: Exception) { call.reject("Couldn’t set that picture: ${e.message}") }
    }
}

class FunPrefs(ctx: Context) {
    private val p = ctx.getSharedPreferences("intra_fun", Context.MODE_PRIVATE)
    var lock: Boolean get() = p.getBoolean("lock", false); set(v) { p.edit().putBoolean("lock", v).apply() }
    var home: Boolean get() = p.getBoolean("home", false); set(v) { p.edit().putBoolean("home", v).apply() }
    var base: String? get() = p.getString("base", null); set(v) { p.edit().putString("base", v).apply() }
}

object FunWallpaper {
    private val newest = AtomicLong(0)      // live doodles send frames quickly: never let an older frame win

    /** A "fun" data push: download the picture and set it — only where this phone allows it. Runs on FCM's worker thread. */
    fun fromPush(ctx: Context, d: Map<String, String>) {
        val prefs = FunPrefs(ctx)
        val want = d["target"] ?: "lock"
        val lock = (want == "lock" || want == "both") && prefs.lock
        val home = (want == "home" || want == "both") && prefs.home
        if (!lock && !home) return
        val path = d["url"] ?: return
        if (!Regex("^/api/file/[a-f0-9]{24}$").matches(path)) return
        val base = prefs.base ?: AuthPrefs(ctx).baseUrl ?: return
        val at = d["at"]?.toLongOrNull() ?: System.currentTimeMillis()
        if (at < newest.get()) return
        val bytes = download("$base$path") ?: return
        if (at < newest.get()) return
        newest.set(at)
        apply(ctx, bytes, if (lock && home) "both" else if (lock) "lock" else "home")
    }

    fun apply(ctx: Context, bytes: ByteArray, target: String) {
        val bmp = decode(ctx, bytes) ?: return
        val flags = when (target) {
            "home" -> WallpaperManager.FLAG_SYSTEM
            "both" -> WallpaperManager.FLAG_SYSTEM or WallpaperManager.FLAG_LOCK
            else -> WallpaperManager.FLAG_LOCK
        }
        WallpaperManager.getInstance(ctx).setBitmap(bmp, null, true, flags)
    }

    private fun download(url: String): ByteArray? = try {
        val c = URL(url).openConnection() as HttpURLConnection
        c.connectTimeout = 5000; c.readTimeout = 8000
        if (c.responseCode != 200) null else c.inputStream.use { it.readBytes() }.takeIf { it.size in 1..(8 * 1024 * 1024) }
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
