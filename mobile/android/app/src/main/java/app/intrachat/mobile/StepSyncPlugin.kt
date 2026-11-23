package app.intrachat.mobile

import androidx.activity.result.ActivityResult
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.HealthConnectFeatures
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.permission.HealthPermission
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.util.concurrent.TimeUnit

/** JS: Capacitor.nativePromise('StepSync', 'configure' | 'stop' | 'status' | 'requestBackground' | 'syncNow', …) */
@CapacitorPlugin(name = "StepSync")
class StepSyncPlugin : Plugin() {
    private val scope = CoroutineScope(Dispatchers.Main)
    private val backgroundPermission = HealthPermission.PERMISSION_READ_HEALTH_DATA_IN_BACKGROUND

    private fun backgroundSupported(): Boolean = try {
        HealthConnectClient.getSdkStatus(context) == HealthConnectClient.SDK_AVAILABLE &&
            HealthConnectClient.getOrCreate(context).features.getFeatureStatus(HealthConnectFeatures.FEATURE_READ_HEALTH_DATA_IN_BACKGROUND) ==
            HealthConnectFeatures.FEATURE_STATUS_AVAILABLE
    } catch (e: Exception) { false }

    private suspend fun backgroundGranted(): Boolean = try {
        backgroundPermission in HealthConnectClient.getOrCreate(context).permissionController.getGrantedPermissions()
    } catch (e: Exception) { false }

    /** Save where/as whom to upload and start the ~30-minute background job. */
    @PluginMethod
    fun configure(call: PluginCall) {
        val base = call.getString("baseUrl")
        val token = call.getString("token")
        if (base.isNullOrBlank() || token.isNullOrBlank() || !base.startsWith("https://")) { call.reject("baseUrl (https) and token are required"); return }
        StepSyncPrefs(context).apply { baseUrl = base.trimEnd('/'); this.token = token; device = call.getString("device") }
        val work = PeriodicWorkRequestBuilder<StepSyncWorker>(30, TimeUnit.MINUTES)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(WORK, ExistingPeriodicWorkPolicy.UPDATE, work)
        call.resolve()
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        WorkManager.getInstance(context).cancelUniqueWork(WORK)
        StepSyncPrefs(context).clear()
        call.resolve()
    }

    @PluginMethod
    fun syncNow(call: PluginCall) {
        WorkManager.getInstance(context).enqueueUniqueWork("$WORK-now", ExistingWorkPolicy.REPLACE, OneTimeWorkRequestBuilder<StepSyncWorker>().build())
        call.resolve()
    }

    @PluginMethod
    fun status(call: PluginCall) {
        scope.launch {
            val prefs = StepSyncPrefs(context)
            call.resolve(JSObject().apply {
                put("configured", prefs.token != null)
                put("backgroundSupported", backgroundSupported())
                put("backgroundGranted", backgroundGranted())
                put("lastSync", prefs.lastSync)
            })
        }
    }

    /** Ask for "access data in the background" (Health Connect shows its own screen). */
    @PluginMethod
    fun requestBackground(call: PluginCall) {
        if (!backgroundSupported()) { call.resolve(JSObject().put("granted", false).put("supported", false)); return }
        scope.launch {
            if (backgroundGranted()) { call.resolve(JSObject().put("granted", true).put("supported", true)); return@launch }
            val intent = PermissionController.createRequestPermissionResultContract().createIntent(context, setOf(backgroundPermission))
            startActivityForResult(call, intent, "backgroundResult")
        }
    }

    @ActivityCallback
    private fun backgroundResult(call: PluginCall, result: ActivityResult) {
        scope.launch { call.resolve(JSObject().put("granted", backgroundGranted()).put("supported", true)) }
    }

    companion object { const val WORK = "intra-step-sync" }
}
