package app.intrachat.mobile;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(StepSyncPlugin.class);   // background Health Connect step sync
        super.onCreate(savedInstanceState);
    }
}
