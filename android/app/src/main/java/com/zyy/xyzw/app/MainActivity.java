package com.zyy.xyzw.app;

import android.os.Bundle;

import androidx.annotation.Nullable;
import androidx.core.view.WindowCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        registerPlugin(BinFolderPickerPlugin.class);
        registerPlugin(NativeFileSavePlugin.class);
        registerPlugin(NativeHttpPlugin.class);
        super.onCreate(savedInstanceState);

        // Android 15+ forces edge-to-edge for this target SDK. Keep the WebView
        // edge-to-edge and let CSS safe-area insets protect the top and bottom UI.
        WindowCompat.enableEdgeToEdge(getWindow());
        WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView())
                .setAppearanceLightStatusBars(true);
        WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView())
                .setAppearanceLightNavigationBars(true);
        getWindow().setNavigationBarContrastEnforced(false);
    }
}
