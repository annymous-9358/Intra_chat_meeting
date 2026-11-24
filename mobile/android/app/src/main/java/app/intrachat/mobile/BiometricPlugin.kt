package app.intrachat.mobile

import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_WEAK
import androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.Signature
import java.security.spec.ECGenParameterSpec

/**
 * Fingerprint / face lock.
 * JS: Capacitor.nativePromise('Biometric', 'status')                       → { available, strong }
 *     Capacitor.nativePromise('Biometric', 'verify', { title })            → app lock: fingerprint, face or the phone's PIN/pattern
 *     Capacitor.nativePromise('Biometric', 'createKey', { alias })         → { publicKey } (SPKI, base64) for hidden chats
 *     Capacitor.nativePromise('Biometric', 'sign', { alias, challenge })   → { signature } after fingerprint / phone PIN
 *     Capacitor.nativePromise('Biometric', 'deleteKey', { alias })
 * Errors: code "CANCELLED" when the person backs out, "NO_KEY"/"KEY_CHANGED" when the key is gone or a new fingerprint was added.
 */
@CapacitorPlugin(name = "Biometric")
class BiometricPlugin : Plugin() {
    private fun keyStore() = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    private val modern get() = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R   // Android 11+: biometrics or phone PIN in one prompt

    @PluginMethod
    fun status(call: PluginCall) {
        val bm = BiometricManager.from(context)
        val ok = { a: Int -> bm.canAuthenticate(a) == BiometricManager.BIOMETRIC_SUCCESS }
        val any = ok(BIOMETRIC_WEAK) || (modern && ok(DEVICE_CREDENTIAL))
        val strong = ok(BIOMETRIC_STRONG) || (modern && ok(DEVICE_CREDENTIAL))
        call.resolve(JSObject().put("available", any).put("strong", strong))
    }

    /** App lock: any fingerprint/face the phone has, or its PIN/pattern. */
    @PluginMethod
    fun verify(call: PluginCall) {
        prompt(call, if (modern) BIOMETRIC_WEAK or DEVICE_CREDENTIAL else BIOMETRIC_WEAK, null) {
            call.resolve(JSObject().put("ok", true))
        }
    }

    /** A signing key that only works right after fingerprint (or the phone's PIN on Android 11+). */
    @PluginMethod
    fun createKey(call: PluginCall) {
        val alias = call.getString("alias")
        if (alias.isNullOrBlank()) { call.reject("alias is required"); return }
        try {
            val ks = keyStore(); if (ks.containsAlias(alias)) ks.deleteEntry(alias)
            val spec = KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_SIGN)
                .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
                .setDigests(KeyProperties.DIGEST_SHA256)
                .setUserAuthenticationRequired(true)
                .setInvalidatedByBiometricEnrollment(true)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) spec.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG or KeyProperties.AUTH_DEVICE_CREDENTIAL)
            val gen = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore")
            gen.initialize(spec.build())
            val pair = gen.generateKeyPair()
            call.resolve(JSObject().put("publicKey", Base64.encodeToString(pair.public.encoded, Base64.NO_WRAP)))
        } catch (e: Exception) {
            call.reject("Couldn’t set up fingerprint unlock: ${e.message}")
        }
    }

    @PluginMethod
    fun sign(call: PluginCall) {
        val alias = call.getString("alias"); val challenge = call.getString("challenge")
        if (alias.isNullOrBlank() || challenge.isNullOrBlank()) { call.reject("alias and challenge are required"); return }
        val sig: Signature
        try {
            val key = keyStore().getKey(alias, null) as? PrivateKey
            if (key == null) { call.reject("Fingerprint unlock isn’t set up on this phone", "NO_KEY"); return }
            sig = Signature.getInstance("SHA256withECDSA"); sig.initSign(key)
        } catch (e: KeyPermanentlyInvalidatedException) {
            call.reject("Your fingerprints changed — set fingerprint unlock up again", "KEY_CHANGED"); return
        } catch (e: Exception) {
            call.reject("Fingerprint unlock isn’t available: ${e.message}", "NO_KEY"); return
        }
        prompt(call, if (modern) BIOMETRIC_STRONG or DEVICE_CREDENTIAL else BIOMETRIC_STRONG, BiometricPrompt.CryptoObject(sig)) { res ->
            try {
                val s = res.cryptoObject?.signature ?: throw IllegalStateException("no signature")
                s.update(Base64.decode(challenge, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING))
                call.resolve(JSObject().put("signature", Base64.encodeToString(s.sign(), Base64.NO_WRAP)))
            } catch (e: Exception) {
                call.reject("Fingerprint check failed: ${e.message}")
            }
        }
    }

    @PluginMethod
    fun deleteKey(call: PluginCall) {
        val alias = call.getString("alias")
        try { if (!alias.isNullOrBlank()) keyStore().deleteEntry(alias) } catch (_: Exception) {}
        call.resolve()
    }

    private fun prompt(call: PluginCall, authenticators: Int, crypto: BiometricPrompt.CryptoObject?, onOk: (BiometricPrompt.AuthenticationResult) -> Unit) {
        val act = activity as? FragmentActivity
        if (act == null) { call.reject("The app isn’t on screen"); return }
        act.runOnUiThread {
            val info = BiometricPrompt.PromptInfo.Builder()
                .setTitle(call.getString("title") ?: "Unlock Intra Chat")
                .setAllowedAuthenticators(authenticators)
            call.getString("subtitle")?.let { info.setSubtitle(it) }
            if (authenticators and DEVICE_CREDENTIAL == 0) info.setNegativeButtonText(call.getString("cancel") ?: "Use code")
            val p = BiometricPrompt(act, ContextCompat.getMainExecutor(context), object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) = onOk(result)
                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                    val cancelled = errorCode == BiometricPrompt.ERROR_NEGATIVE_BUTTON || errorCode == BiometricPrompt.ERROR_USER_CANCELED || errorCode == BiometricPrompt.ERROR_CANCELED
                    call.reject(errString.toString(), if (cancelled) "CANCELLED" else "ERROR_$errorCode")
                }
            })
            try { if (crypto != null) p.authenticate(info.build(), crypto) else p.authenticate(info.build()) }
            catch (e: Exception) { call.reject("Fingerprint/face isn’t available: ${e.message}") }
        }
    }
}
