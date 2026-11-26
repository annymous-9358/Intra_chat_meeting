package app.intrachat.mobile

import android.app.WallpaperManager
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.RectF
import android.graphics.Shader
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.service.wallpaper.WallpaperService
import android.view.SurfaceHolder
import androidx.core.graphics.ColorUtils
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Fun mode's live wallpaper: friends' photos and videos show instantly, and doodles appear and animate on the home and
 * lock screen while they're drawn (strokes are pulled from the server every 250 ms while a doodle is in progress).
 * The person chooses it once in the system "Set wallpaper" screen. With nothing sent, it shows their own photo.
 */
class IntraWallpaperService : WallpaperService() {
    override fun onCreateEngine(): Engine = FunEngine()

    inner class FunEngine : Engine() {
        private val main = Handler(Looper.getMainLooper())
        private val io = Executors.newSingleThreadExecutor()
        private var visible = false
        private var w = 0; private var h = 0
        private var photo: Bitmap? = null
        private var fallback: Bitmap? = null
        private var player: ExoPlayer? = null
        private var doodle: FunDoodle? = null
        private var pulling = false
        private val tick = object : Runnable { override fun run() { frame() } }

        override fun onCreate(surfaceHolder: SurfaceHolder) {
            super.onCreate(surfaceHolder)
            FunBus.engine = this
            fallback = loadFile(File(filesDir, "fun_default.jpg"))
        }

        private var restored = false
        override fun onSurfaceCreated(holder: SurfaceHolder) {
            super.onSurfaceCreated(holder)
            if (!restored) { restored = true; restoreSaved() }       // a video needs the surface, so wait for it
        }

        override fun onDestroy() {
            if (FunBus.engine === this) FunBus.engine = null
            main.removeCallbacks(tick); pulling = false
            player?.release(); player = null
            io.shutdownNow()
            super.onDestroy()
        }

        override fun onSurfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
            super.onSurfaceChanged(holder, format, width, height)
            w = width; h = height
            doodle?.resize(h)
            draw()
        }

        override fun onVisibilityChanged(v: Boolean) {
            visible = v
            player?.playWhenReady = v
            if (v) { doodle?.let { if (!it.done) startPull(it) }; draw(); if (doodle?.animating == true) main.post(tick) }
            else main.removeCallbacks(tick)
        }

        // ---- what to show --------------------------------------------------------------------------------------
        fun showPhoto(url: String) = io.execute {
            val bmp = download(url)?.let { decode(it) } ?: return@execute
            main.post { stopVideo(); doodle = null; pulling = false; photo = bmp; draw() }
        }

        fun showVideo(url: String) = main.post {
            doodle = null; pulling = false; photo = null
            val p = player ?: ExoPlayer.Builder(applicationContext).build().also { player = it }
            p.setVideoSurface(surfaceHolder.surface)
            p.setMediaItem(MediaItem.fromUri(Uri.parse(url)))
            p.repeatMode = Player.REPEAT_MODE_ALL
            p.volume = 0f
            p.videoScalingMode = C.VIDEO_SCALING_MODE_SCALE_TO_FIT_WITH_CROPPING
            p.prepare(); p.playWhenReady = visible
        }

        fun followDoodle(room: String, sid: String) = main.post {
            if (doodle?.sid == sid) return@post
            stopVideo(); photo = null
            doodle = FunDoodle(room, sid).also { it.resize(if (h > 0) h else 2340) }
            draw()
            if (visible) startPull(doodle!!)
        }

        fun backToMine() = main.post { stopVideo(); doodle = null; pulling = false; photo = null; fallback = loadFile(File(filesDir, "fun_default.jpg")); draw() }

        fun isShowing(sid: String) = doodle?.sid == sid

        private fun stopVideo() { player?.let { it.clearVideoSurface(); it.release() }; player = null }

        private fun restoreSaved() {
            val p = FunPrefs(applicationContext)
            val url = p.itemUrl; val base = p.base ?: AuthPrefs(applicationContext).baseUrl
            when (p.itemKind) {
                "video" -> if (url != null && base != null) showVideo(base + url)
                "doodle" -> { val room = p.itemRoom; val sid = p.itemSid
                    if (url != null && base != null) showPhoto(base + url)          // finished: its final picture
                    else if (room != null && sid != null) followDoodle(room, sid) }
                "photo" -> if (url != null && base != null) showPhoto(base + url)
            }
        }

        // ---- following a doodle ------------------------------------------------------------------------------------
        private fun startPull(d: FunDoodle) {
            if (pulling) return
            pulling = true
            io.execute {
                var quietSince = System.currentTimeMillis()
                while (pulling && visible && doodle === d && !d.done) {
                    val r = FunBus.watch(applicationContext, d.room, d.sid, d.seq)
                    if (r != null) {
                        val changed = r.optJSONObject("doodle")
                        if (changed != null || r.optBoolean("done")) {
                            quietSince = System.currentTimeMillis()
                            val bg = changed?.optString("bgUrl", "")?.takeIf { it.isNotEmpty() && it != d.bgUrl }?.let { u -> download(FunBus.base(applicationContext) + u)?.let { decode(it) } to u }
                            main.post { if (doodle === d) { if (bg != null) { d.bgImg = bg.first; d.bgUrl = bg.second }; d.apply(r); if (!d.animating) d.animating = true; main.removeCallbacks(tick); main.post(tick) } }
                        }
                    }
                    if (System.currentTimeMillis() - quietSince > 30_000) break       // nothing for a while: stop asking
                    try { Thread.sleep(250) } catch (_: InterruptedException) { break }
                }
                pulling = false
            }
        }

        private fun frame() {
            val d = doodle ?: return
            val busy = d.step()
            draw()
            if (busy && visible) main.postDelayed(tick, 16) else d.animating = busy
        }

        // ---- drawing ---------------------------------------------------------------------------------------------
        private fun draw() {
            if (player != null || w == 0 || h == 0) return              // a video owns the surface
            val holder = surfaceHolder
            val c = try { holder.lockCanvas() } catch (_: Exception) { null } ?: return
            try {
                val d = doodle
                when {
                    d != null -> d.drawOn(c, w, h)
                    photo != null -> cover(c, photo!!)
                    fallback != null -> cover(c, fallback!!)
                    else -> c.drawPaint(Paint().apply { shader = LinearGradient(0f, 0f, w.toFloat(), h.toFloat(), Color.parseColor("#0f766e"), Color.parseColor("#312e81"), Shader.TileMode.CLAMP) })
                }
            } finally { try { holder.unlockCanvasAndPost(c) } catch (_: Exception) { } }
        }

        private fun cover(c: Canvas, b: Bitmap) {
            val s = max(w.toFloat() / b.width, h.toFloat() / b.height)
            val dw = b.width * s; val dh = b.height * s
            c.drawColor(Color.BLACK)
            c.drawBitmap(b, null, RectF((w - dw) / 2, (h - dh) / 2, (w + dw) / 2, (h + dh) / 2), Paint(Paint.FILTER_BITMAP_FLAG))
        }

        private fun decode(bytes: ByteArray): Bitmap? {
            val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, o)
            val target = max(2340, max(w, h)); var s = 1
            while (max(o.outWidth, o.outHeight) / (s * 2) >= target) s *= 2
            return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = s })
        }
        private fun loadFile(f: File): Bitmap? = if (f.exists()) try { decode(f.readBytes()) } catch (_: Exception) { null } else null
    }

    companion object {
        fun download(url: String): ByteArray? = try {
            val c = URL(url).openConnection() as HttpURLConnection
            c.connectTimeout = 5000; c.readTimeout = 10000
            if (c.responseCode != 200) null else c.inputStream.use { it.readBytes() }
        } catch (_: Exception) { null }

        fun isActive(ctx: Context): Boolean = try { WallpaperManager.getInstance(ctx).wallpaperInfo?.packageName == ctx.packageName } catch (_: Exception) { false }
    }
}

/** Hands friends' pictures, videos and doodles to the live wallpaper (or remembers them until it starts). */
object FunBus {
    @Volatile var engine: IntraWallpaperService.FunEngine? = null

    fun base(ctx: Context): String = FunPrefs(ctx).base ?: AuthPrefs(ctx).baseUrl ?: ""

    fun show(ctx: Context, kind: String, path: String, sid: String?, room: String?) {
        val p = FunPrefs(ctx)
        // the final picture of a doodle the wallpaper is already drawing live: keep the live strokes
        if (kind == "doodle" && sid != null && engine?.isShowing(sid) == true) { p.itemKind = "doodle"; p.itemUrl = path; return }
        p.itemKind = if (kind == "video") "video" else "photo"; p.itemUrl = path; p.itemSid = sid; p.itemRoom = room
        val e = engine ?: return
        if (kind == "video") e.showVideo(base(ctx) + path) else e.showPhoto(base(ctx) + path)
    }

    fun live(ctx: Context, room: String, sid: String) {
        val p = FunPrefs(ctx); p.itemKind = "doodle"; p.itemSid = sid; p.itemRoom = room; p.itemUrl = null      // its final picture comes later
        engine?.followDoodle(room, sid)
    }

    fun mine(ctx: Context) { FunPrefs(ctx).itemKind = null; engine?.backToMine() }

    /** New strokes of a doodle since `seq` (the same route the app uses), or null if it can't be reached. */
    fun watch(ctx: Context, room: String, sid: String, seq: Int): JSONObject? = try {
        val p = FunPrefs(ctx); val a = AuthPrefs(ctx)
        val token = p.token ?: a.token; val device = p.device ?: a.device
        val c = URL(base(ctx) + "/api/fun/watch").openConnection() as HttpURLConnection
        c.requestMethod = "POST"; c.doOutput = true; c.connectTimeout = 5000; c.readTimeout = 8000
        c.setRequestProperty("content-type", "application/json")
        if (token != null) c.setRequestProperty("authorization", "Bearer $token")
        if (device != null) c.setRequestProperty("x-chat-device", device)
        c.outputStream.use { it.write(JSONObject().put("room", room).put("sid", sid).put("seq", seq).toString().toByteArray()) }
        if (c.responseCode != 200) null else JSONObject(c.inputStream.use { it.readBytes() }.toString(Charsets.UTF_8))
    } catch (_: Exception) { null }
}

/** A doodle being followed: the strokes, how much of each is shown (for the animation), and its layers. */
class FunDoodle(val room: String, val sid: String) {
    var seq = -1; var done = false; var animating = false
    var bg = Color.parseColor("#101418"); var bgUrl: String? = null; var bgImg: Bitmap? = null
    private val strokes = ArrayList<FunStroke?>()
    private val shown = ArrayList<Float>(); private val prog = ArrayList<Float>(); private val committed = ArrayList<Boolean>()
    private var scale = 1f
    private var base: Bitmap? = null; private var layer: Bitmap? = null

    fun resize(screenH: Int) {
        scale = min(1f, screenH / 2340f).coerceAtLeast(0.3f)
        val lw = (1080 * scale).toInt(); val lh = (2340 * scale).toInt()
        if (base?.width != lw) { base = Bitmap.createBitmap(lw, lh, Bitmap.Config.ARGB_8888); layer = Bitmap.createBitmap(lw, lh, Bitmap.Config.ARGB_8888); clearBase() }
    }
    private fun clearBase() { base?.eraseColor(Color.TRANSPARENT); for (i in committed.indices) committed[i] = false }
    private fun ensure(i: Int) { while (strokes.size <= i) { strokes.add(null); shown.add(0f); prog.add(0f); committed.add(false) } }

    fun apply(r: JSONObject) {
        seq = r.optInt("seq", seq); done = r.optBoolean("done", done)
        val d = r.optJSONObject("doodle") ?: return
        if (d.optBoolean("reset")) { strokes.clear(); shown.clear(); prog.clear(); committed.clear(); clearBase() }
        d.optString("bg", "").takeIf { it.startsWith("#") }?.let { try { bg = Color.parseColor(it) } catch (_: Exception) { } }
        if (d.isNull("bgUrl")) { bgUrl = null; bgImg = null }
        val arr = d.optJSONArray("strokes") ?: JSONArray()
        for (k in 0 until arr.length()) {
            val pair = arr.optJSONArray(k) ?: continue
            val i = pair.optInt(0); val st = FunStroke.parse(pair.optJSONObject(1) ?: continue) ?: continue
            ensure(i)
            val old = strokes[i]
            if (committed[i]) clearBase()
            strokes[i] = st
            if (old == null || old.tool != st.tool || st.shape) { shown[i] = if (st.shape) st.n.toFloat() else 0f; prog[i] = if (st.shape && old != null && old.shape) max(0.6f, prog[i]) else 0f }
        }
    }

    private fun finished(i: Int): Boolean { val s = strokes[i] ?: return true; return if (s.shape) prog[i] >= 1f else shown[i] >= s.n }

    /** Advance the animation one frame; true while something is still moving. */
    fun step(): Boolean {
        var busy = false
        for (i in strokes.indices) {
            val s = strokes[i] ?: continue
            if (s.shape) { if (prog[i] < 1f) { prog[i] = min(1f, prog[i] + 0.09f); busy = true } }
            else if (shown[i] < s.n) { shown[i] = min(s.n.toFloat(), shown[i] + max(1f, (s.n - shown[i]) / 14f)); busy = true }
        }
        return busy
    }

    fun drawOn(c: Canvas, w: Int, h: Int) {
        val b = base ?: return; val l = layer ?: return
        val bc = Canvas(b).apply { scale(scale, scale) }
        val last = strokes.size - 1
        for (i in strokes.indices) {        // finished strokes go into the base layer once
            val s = strokes[i] ?: continue
            if (committed[i] || !finished(i) || (i == last && !done)) continue
            s.draw(bc, s.n, 1f); committed[i] = true
        }
        l.eraseColor(Color.TRANSPARENT)
        val lc = Canvas(l); lc.drawBitmap(b, 0f, 0f, null); lc.scale(scale, scale)
        for (i in strokes.indices) { val s = strokes[i] ?: continue; if (!committed[i] && (shown[i] > 0f || prog[i] > 0f)) s.draw(lc, max(1, shown[i].toInt()), prog[i]) }
        // the 1080 × 2340 canvas fills the screen (cropped like a photo)
        val sc = max(w / 1080f, h / 2340f); val dw = 1080 * sc; val dh = 2340 * sc
        val dst = RectF((w - dw) / 2, (h - dh) / 2, (w + dw) / 2, (h + dh) / 2)
        val bi = bgImg
        if (bi != null) c.drawBitmap(bi, null, dst, Paint(Paint.FILTER_BITMAP_FLAG)) else c.drawColor(bg)
        c.drawBitmap(l, null, dst, Paint(Paint.FILTER_BITMAP_FLAG))
    }
}

/** One stroke, drawn exactly like the app does (public/app.js funStroke). */
class FunStroke(val tool: String, val color: Int, val size: Float, val seed: Long, val pts: FloatArray) {
    val n get() = pts.size / 2
    val shape get() = tool in SHAPES

    companion object {
        val SHAPES = setOf("line", "arrow", "rect", "circle", "heart", "star")
        fun parse(o: JSONObject): FunStroke? {
            val tool = o.optString("tool"); val a = o.optJSONArray("pts") ?: return null
            val pts = FloatArray(a.length() * 2)
            for (i in 0 until a.length()) { val p = a.optJSONArray(i) ?: return null; pts[i * 2] = p.optDouble(0).toFloat(); pts[i * 2 + 1] = p.optDouble(1).toFloat() }
            if (pts.isEmpty()) return null
            val col = try { Color.parseColor(o.optString("color", "#ffffff")) } catch (_: Exception) { Color.WHITE }
            return FunStroke(tool, col, o.optDouble("size", 12.0).toFloat(), o.optLong("seed", 0), pts)
        }
    }

    private fun x(i: Int) = pts[i * 2]
    private fun y(i: Int) = pts[i * 2 + 1]
    private fun path(m: Int): Path = Path().apply {
        moveTo(x(0), y(0))
        for (i in 1 until m) quadTo(x(i - 1), y(i - 1), (x(i - 1) + x(i)) / 2, (y(i - 1) + y(i)) / 2)
        if (m == 1) lineTo(x(0) + 0.1f, y(0))
    }

    fun draw(c: Canvas, mIn: Int, t: Float) {
        val m = mIn.coerceIn(1, n)
        val p = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeCap = Paint.Cap.ROUND; strokeJoin = Paint.Join.ROUND; strokeWidth = size; color = this@FunStroke.color }
        if (tool == "eraser") p.xfermode = PorterDuffXfermode(PorterDuff.Mode.CLEAR)
        when (tool) {
            in SHAPES -> shape(c, p, t)
            "spray" -> {
                var s = (seed and 0xffffffffL).toInt().let { if (it == 0) 1 else it }
                fun r(): Double { s = s * 1664525 + 1013904223; return (s.toLong() and 0xffffffffL) / 4294967296.0 }
                val rad = size * 1.3; val k = 6 + Math.round(size / 4f); val dot = max(2.6f, size / 7f)
                p.style = Paint.Style.FILL
                for (i in 0 until m) for (j in 0 until k) {
                    val an = r() * PI * 2; val d = sqrt(r()) * rad; p.alpha = ((0.5 + r() * 0.5) * 255).toInt()
                    val px = (x(i) + cos(an) * d).toFloat(); val py = (y(i) + sin(an) * d).toFloat()
                    c.drawRect(px, py, px + dot, py + dot, p)
                }
            }
            "rainbow" -> {
                val h0 = (seed % 360).toFloat()
                if (m == 1) { p.style = Paint.Style.FILL; p.color = ColorUtils.HSLToColor(floatArrayOf(h0, 0.95f, 0.58f)); c.drawCircle(x(0), y(0), size / 2, p) }
                for (i in 1 until m) { p.color = ColorUtils.HSLToColor(floatArrayOf((h0 + i * 5) % 360, 0.95f, 0.58f)); c.drawLine(x(i - 1), y(i - 1), x(i), y(i), p) }
            }
            "neon" -> {
                val path = path(m)
                p.setShadowLayer(size * 1.4f, 0f, 0f, color); c.drawPath(path, p); c.drawPath(path, p)
                p.clearShadowLayer(); p.strokeWidth = max(2f, size * 0.32f); p.color = Color.WHITE; c.drawPath(path, p)
            }
            "marker" -> { p.alpha = (0.45 * 255).toInt(); p.strokeWidth = size * 1.6f; c.drawPath(path(m), p) }
            else -> c.drawPath(path(m), p)
        }
    }

    private fun shape(c: Canvas, p: Paint, t: Float) {
        val ax = x(0); val ay = y(0); val bx = if (n > 1) x(1) else ax; val by = if (n > 1) y(1) else ay
        val ex = ax + (bx - ax) * t; val ey = ay + (by - ay) * t
        val wd = abs(bx - ax) * t; val ht = abs(by - ay) * t
        when (tool) {
            "line", "arrow" -> {
                c.drawLine(ax, ay, ex, ey, p)
                if (tool == "arrow" && t > 0.6f) {
                    val ang = atan2((ey - ay).toDouble(), (ex - ax).toDouble()); val l = max(30f, size * 3)
                    c.drawLine((ex - l * cos(ang - 0.5)).toFloat(), (ey - l * sin(ang - 0.5)).toFloat(), ex, ey, p)
                    c.drawLine((ex - l * cos(ang + 0.5)).toFloat(), (ey - l * sin(ang + 0.5)).toFloat(), ex, ey, p)
                }
            }
            "rect" -> { val l = if (ax < bx) min(ax, bx) else ax - wd; val tp = if (ay < by) min(ay, by) else ay - ht; c.drawRect(l, tp, l + wd, tp + ht, p) }
            "circle" -> { val rx = max(1f, abs(bx - ax) / 2); val ry = max(1f, abs(by - ay) / 2); val cx = (ax + bx) / 2; val cy = (ay + by) / 2; c.drawArc(RectF(cx - rx, cy - ry, cx + rx, cy + ry), -90f, 360f * t, false, p) }
            else -> {
                val cx = (ax + bx) / 2; val cy = (ay + by) / 2
                val wW = max(20f, abs(bx - ax)) * t; val hH = max(20f, abs(by - ay)) * t
                val path = Path()
                if (tool == "heart") {
                    path.moveTo(cx, cy + hH * 0.42f)
                    path.cubicTo(cx - wW * 0.62f, cy, cx - wW * 0.5f, cy - hH * 0.52f, cx, cy - hH * 0.2f)
                    path.cubicTo(cx + wW * 0.5f, cy - hH * 0.52f, cx + wW * 0.62f, cy, cx, cy + hH * 0.42f)
                } else for (i in 0 until 10) {
                    val r = if (i % 2 == 1) 0.4f else 1f; val an = -PI / 2 + i * PI / 5
                    val px = (cx + cos(an) * wW / 2 * r).toFloat(); val py = (cy + sin(an) * hH / 2 * r).toFloat()
                    if (i == 0) path.moveTo(px, py) else path.lineTo(px, py)
                }
                path.close(); p.style = Paint.Style.FILL; c.drawPath(path, p)
            }
        }
    }
}
