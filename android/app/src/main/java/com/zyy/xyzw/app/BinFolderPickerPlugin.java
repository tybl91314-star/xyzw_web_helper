package com.zyy.xyzw.app;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.util.Base64;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.Locale;

@CapacitorPlugin(name = "BinFolderPicker")
public class BinFolderPickerPlugin extends Plugin {
    private static final int MAX_FILES = 1000;
    private static final long MAX_TOTAL_BYTES = 50L * 1024L * 1024L;

    @PluginMethod
    public void pickBinFolder(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(
                Intent.FLAG_GRANT_READ_URI_PERMISSION
                        | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
                        | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION
        );
        startActivityForResult(call, intent, "folderPicked");
    }

    @ActivityCallback
    private void folderPicked(PluginCall call, ActivityResult activityResult) {
        if (activityResult.getResultCode() != Activity.RESULT_OK
                || activityResult.getData() == null
                || activityResult.getData().getData() == null) {
            JSObject result = new JSObject();
            result.put("files", new JSArray());
            call.resolve(result);
            return;
        }

        Uri treeUri = activityResult.getData().getData();
        int takeFlags = activityResult.getData().getFlags()
                & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        try {
            getContext().getContentResolver().takePersistableUriPermission(treeUri, takeFlags);
        } catch (Exception ignored) {
            // Some document providers grant access only for the current activity.
        }

        execute(() -> {
            try {
                JSArray files = new JSArray();
                long[] totalBytes = {0L};
                String rootDocumentId = DocumentsContract.getTreeDocumentId(treeUri);
                String rootName = getDocumentName(treeUri, rootDocumentId);
                collectBinFiles(treeUri, rootDocumentId, rootName, files, totalBytes);

                JSObject result = new JSObject();
                result.put("files", files);
                call.resolve(result);
            } catch (Exception error) {
                call.reject("读取文件夹失败: " + error.getMessage(), error);
            }
        });
    }

    private String getDocumentName(Uri treeUri, String documentId) {
        Uri documentUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, documentId);
        try (Cursor cursor = getContext().getContentResolver().query(
                documentUri,
                new String[]{DocumentsContract.Document.COLUMN_DISPLAY_NAME},
                null,
                null,
                null
        )) {
            if (cursor != null && cursor.moveToFirst()) {
                String name = cursor.getString(0);
                if (name != null && !name.trim().isEmpty()) return name;
            }
        } catch (Exception ignored) {
        }
        return "导入文件夹";
    }

    private void collectBinFiles(
            Uri treeUri,
            String parentDocumentId,
            String relativePath,
            JSArray files,
            long[] totalBytes
    ) throws Exception {
        if (files.length() >= MAX_FILES) {
            throw new IllegalStateException("文件数量超过 " + MAX_FILES + " 个");
        }

        Uri childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(
                treeUri,
                parentDocumentId
        );
        String[] projection = {
                DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                DocumentsContract.Document.COLUMN_MIME_TYPE,
                DocumentsContract.Document.COLUMN_SIZE
        };

        try (Cursor cursor = getContext().getContentResolver().query(
                childrenUri,
                projection,
                null,
                null,
                null
        )) {
            if (cursor == null) return;

            while (cursor.moveToNext()) {
                String documentId = cursor.getString(0);
                String displayName = cursor.getString(1);
                String mimeType = cursor.getString(2);
                String childPath = relativePath.isEmpty()
                        ? displayName
                        : relativePath + "/" + displayName;

                if (DocumentsContract.Document.MIME_TYPE_DIR.equals(mimeType)) {
                    collectBinFiles(treeUri, documentId, childPath, files, totalBytes);
                    continue;
                }

                String lowerName = displayName.toLowerCase(Locale.ROOT);
                if (!lowerName.endsWith(".bin") && !lowerName.endsWith(".dmp")) {
                    continue;
                }

                Uri documentUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, documentId);
                byte[] bytes = readDocument(documentUri);
                totalBytes[0] += bytes.length;
                if (totalBytes[0] > MAX_TOTAL_BYTES) {
                    throw new IllegalStateException("BIN文件总大小超过50MB");
                }

                JSObject file = new JSObject();
                file.put("name", displayName);
                file.put("relativePath", childPath);
                file.put("data", Base64.encodeToString(bytes, Base64.NO_WRAP));
                files.put(file);
            }
        }
    }

    private byte[] readDocument(Uri documentUri) throws Exception {
        try (
                InputStream input = getContext().getContentResolver().openInputStream(documentUri);
                ByteArrayOutputStream output = new ByteArrayOutputStream()
        ) {
            if (input == null) throw new IllegalStateException("无法打开文件");
            byte[] buffer = new byte[8192];
            int read;
            while ((read = input.read(buffer)) != -1) {
                output.write(buffer, 0, read);
            }
            return output.toByteArray();
        }
    }
}
