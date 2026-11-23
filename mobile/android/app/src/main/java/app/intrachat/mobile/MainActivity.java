package app.intrachat.mobile;

import android.content.Intent;
import android.os.Bundle;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {
    /** True while the app is on screen (the web app then plays the walkie-talkie itself). */
    public static volatile boolean visible = false;
    /** Chat to open after tapping "… is talking" while the app was closed (read by the web app). */
    public static volatile String pendingRoom = null;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(StepSyncPlugin.class);   // background Health Connect step sync
        registerPlugin(WalkiePlugin.class);     // keeps the walkie-talkie alive in the background
        super.onCreate(savedInstanceState);
        takeRoom(getIntent());

        // Back gesture / button: step back through the app's own screens (pop-up → chat → tab), like the website.
        // With nothing left to go back to, send the app to the background (like WhatsApp) instead of closing it,
        // so the walkie-talkie and an open chat keep running.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView wv = getBridge() != null ? getBridge().getWebView() : null;
                if (wv != null && wv.canGoBack()) wv.goBack();
                else moveTaskToBack(true);
            }
        });
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        takeRoom(intent);
        String room = pendingRoom;
        WebView wv = getBridge() != null ? getBridge().getWebView() : null;
        if (room != null && wv != null) {
            pendingRoom = null;
            wv.evaluateJavascript("window.runIntent && runIntent({ room: " + JSONObject.quote(room) + ", act: 'walkie' })", null);
        }
    }

    private void takeRoom(Intent intent) {
        String room = intent != null ? intent.getStringExtra("room") : null;
        if (room != null && room.matches("[a-z0-9_-]{1,40}")) pendingRoom = room;
    }

    @Override
    public void onResume() { super.onResume(); visible = true; }

    @Override
    public void onPause() { visible = false; super.onPause(); }
}
