package app.intrachat.mobile

import android.content.Context
import android.util.Log
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.request.AggregateGroupByPeriodRequest
import androidx.health.connect.client.time.TimeRangeFilter
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.Period

/**
 * Runs about every 30 minutes, even when the app is closed: reads the last 7 days of daily step totals from
 * Health Connect and sends them to Intra Chat (POST /api/steps/import). The server never lowers a day's count.
 * Needs the READ_STEPS and READ_HEALTH_DATA_IN_BACKGROUND permissions; without the latter it only works while
 * the app is open, which the web code already covers.
 */
class StepSyncWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {

    override suspend fun doWork(): Result {
        val prefs = StepSyncPrefs(applicationContext)
        val base = prefs.baseUrl ?: return Result.success()
        val token = prefs.token ?: return Result.success()
        if (HealthConnectClient.getSdkStatus(applicationContext) != HealthConnectClient.SDK_AVAILABLE) return Result.success()

        val client = HealthConnectClient.getOrCreate(applicationContext)
        val granted = try { client.permissionController.getGrantedPermissions() } catch (e: Exception) { emptySet() }
        if (HealthPermission.getReadPermission(StepsRecord::class) !in granted) return Result.success()

        val days = JSONObject()
        try {
            val today = LocalDate.now()
            val groups = client.aggregateGroupByPeriod(
                AggregateGroupByPeriodRequest(
                    metrics = setOf(StepsRecord.COUNT_TOTAL),
                    timeRangeFilter = TimeRangeFilter.between(today.minusDays(6).atStartOfDay(), LocalDateTime.now()),
                    timeRangeSlicer = Period.ofDays(1),
                )
            )
            for (g in groups) days.put(g.startTime.toLocalDate().toString(), g.result[StepsRecord.COUNT_TOTAL] ?: 0L)
        } catch (e: SecurityException) {
            Log.i(TAG, "No background access to Health Connect: ${e.message}")
            return Result.success()
        } catch (e: Exception) {
            Log.w(TAG, "Health Connect read failed", e)
            return Result.retry()
        }

        val body = JSONObject()
            .put("room", "general")
            .put("src", "health-connect")
            .put("today", LocalDate.now().toString())
            .put("days", days)
        return withContext(Dispatchers.IO) {
            try {
                val conn = (URL("$base/api/steps/import").openConnection() as HttpURLConnection).apply {
                    requestMethod = "POST"
                    connectTimeout = 15_000
                    readTimeout = 20_000
                    doOutput = true
                    setRequestProperty("Content-Type", "application/json")
                    setRequestProperty("Authorization", "Bearer $token")
                    prefs.device?.let { setRequestProperty("X-Chat-Device", it) }
                }
                conn.outputStream.use { it.write(body.toString().toByteArray()) }
                val code = conn.responseCode
                conn.disconnect()
                when {
                    code in 200..299 -> { prefs.lastSync = System.currentTimeMillis(); Result.success() }
                    code == 401 -> { prefs.clear(); Result.success() }          // signed out: stop syncing
                    else -> Result.retry()
                }
            } catch (e: Exception) {
                Log.w(TAG, "Upload failed", e)
                Result.retry()
            }
        }
    }

    companion object { const val TAG = "IntraStepSync" }
}

/** Where to send steps and as whom. Written by the web app through the StepSync plugin. */
class StepSyncPrefs(ctx: Context) {
    private val p = ctx.getSharedPreferences("intra_step_sync", Context.MODE_PRIVATE)
    var baseUrl: String? get() = p.getString("base", null); set(v) { p.edit().putString("base", v).apply() }
    var token: String? get() = p.getString("token", null); set(v) { p.edit().putString("token", v).apply() }
    var device: String? get() = p.getString("device", null); set(v) { p.edit().putString("device", v).apply() }
    var lastSync: Long get() = p.getLong("last", 0); set(v) { p.edit().putLong("last", v).apply() }
    fun clear() { p.edit().clear().apply() }
}
