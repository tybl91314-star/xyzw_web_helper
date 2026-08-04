package com.zyy.xyzw.app;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.OutputStream;

@CapacitorPlugin(name = "NativeFileSave")
public class NativeFileSavePlugin extends Plugin {
    @PluginMethod
    public void saveFile(PluginCall call) {
        String filename = call.getString("filename", "export.bin");
        String mimeType = call.getString("mimeType", "application/octet-stream");
        String data = call.getString("data");
        if (data == null || data.isEmpty()) {
            call.reject("文件内容为空");
            return;
        }

        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(mimeType);
        intent.putExtra(Intent.EXTRA_TITLE, filename);
        startActivityForResult(call, intent, "fileCreated");
    }

    @ActivityCallback
    private void fileCreated(PluginCall call, ActivityResult activityResult) {
        if (activityResult.getResultCode() != Activity.RESULT_OK
                || activityResult.getData() == null
                || activityResult.getData().getData() == null) {
            call.reject("已取消保存");
            return;
        }

        Uri uri = activityResult.getData().getData();
        String encoded = call.getString("data");
        execute(() -> {
            try (OutputStream output = getContext().getContentResolver().openOutputStream(uri, "w")) {
                if (output == null) throw new IllegalStateException("无法打开保存位置");
                output.write(Base64.decode(encoded, Base64.DEFAULT));
                output.flush();
                JSObject result = new JSObject();
                result.put("saved", true);
                result.put("uri", uri.toString());
                call.resolve(result);
            } catch (Exception error) {
                call.reject("保存文件失败: " + error.getMessage(), error);
            }
        });
    }
}
