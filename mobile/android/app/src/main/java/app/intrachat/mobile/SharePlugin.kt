package app.intrachat.mobile

import android.content.Intent
import androidx.core.content.FileProvider
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * Share a message to other apps with Android's share sheet.
 * JS: Capacitor.nativePromise('IntraShare', 'share', { text, fileUrl?, mime?, name? })
 *     fileUrl (a photo / voice note): downloaded and shared as a real file, with the text alongside.
 */
@CapacitorPlugin(name = "IntraShare")
class SharePlugin : Plugin() {
    @PluginMethod
    fun share(call: PluginCall) {
        val text = call.getString("text") ?: ""
        val fileUrl = call.getString("fileUrl")
        Thread {
            try {
                val send = Intent(Intent.ACTION_SEND)
                if (fileUrl != null && fileUrl.startsWith("https://")) {
                    val bytes = (URL(fileUrl).openConnection() as HttpURLConnection).run {
                        connectTimeout = 8000; readTimeout = 15000
                        if (responseCode != 200) throw IllegalStateException("download failed ($responseCode)")
                        inputStream.use { it.readBytes() }
                    }
                    val dir = File(context.cacheDir, "shared").apply { mkdirs(); listFiles()?.forEach { it.delete() } }
                    val name = (call.getString("name") ?: "intra-chat").replace(Regex("[^A-Za-z0-9._-]"), "_")
                    val f = File(dir, name).apply { writeBytes(bytes) }
                    val uri = FileProvider.getUriForFile(context, context.packageName + ".fileprovider", f)
                    send.type = call.getString("mime") ?: "application/octet-stream"
                    send.putExtra(Intent.EXTRA_STREAM, uri)
                    send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    if (text.isNotEmpty()) send.putExtra(Intent.EXTRA_TEXT, text)
                } else {
                    send.type = "text/plain"
                    send.putExtra(Intent.EXTRA_TEXT, text)
                }
                val chooser = Intent.createChooser(send, "Share").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                activity.runOnUiThread { try { activity.startActivity(chooser); call.resolve() } catch (e: Exception) { call.reject("Couldn’t share: ${e.message}") } }
            } catch (e: Exception) { call.reject("Couldn’t share: ${e.message}") }
        }.start()
    }
}
