package app.intrachat.mobile;

import android.os.Bundle;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(StepSyncPlugin.class);   // background Health Connect step sync
        registerPlugin(WalkiePlugin.class);     // keeps the walkie-talkie alive in the background
        super.onCreate(savedInstanceState);

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
}
