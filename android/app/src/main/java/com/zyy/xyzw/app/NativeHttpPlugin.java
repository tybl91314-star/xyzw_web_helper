package com.zyy.xyzw.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

@CapacitorPlugin(name = "NativeHttp")
public class NativeHttpPlugin extends Plugin {
    private static final Set<String> ALLOWED_HOSTS = new HashSet<>(Arrays.asList(
            "open.weixin.qq.com",
            "long.open.weixin.qq.com",
            "comb-platform.hortorgames.com"
    ));

    @PluginMethod
    public void request(PluginCall call) {
        String urlText = call.getString("url");
        String method = call.getString("method", "GET").toUpperCase();
        String body = call.getString("body");

        if (urlText == null || urlText.isEmpty()) {
            call.reject("请求地址为空");
            return;
        }

        execute(() -> {
            HttpURLConnection connection = null;
            try {
                URL url = new URL(urlText);
                if (!"https".equalsIgnoreCase(url.getProtocol())
                        || !ALLOWED_HOSTS.contains(url.getHost().toLowerCase())) {
                    throw new IllegalArgumentException("不允许访问该网络地址");
                }

                connection = (HttpURLConnection) url.openConnection();
                connection.setRequestMethod(method);
                connection.setConnectTimeout(call.getInt("connectTimeout", 15000));
                connection.setReadTimeout(call.getInt("readTimeout", 15000));
                connection.setInstanceFollowRedirects(true);
                connection.setUseCaches(false);
                connection.setRequestProperty("User-Agent", call.getString(
                        "userAgent",
                        "Mozilla/5.0 (Linux; Android 12; wv) AppleWebKit/537.36 "
                                + "(KHTML, like Gecko) Version/4.0 Chrome/120.0 Mobile Safari/537.36"
                ));
                connection.setRequestProperty("Accept", call.getString("accept", "*/*"));
                String referer = call.getString("referer");
                if (referer != null && !referer.isEmpty()) {
                    connection.setRequestProperty("Referer", referer);
                }
                String origin = call.getString("origin");
                if (origin != null && !origin.isEmpty()) {
                    connection.setRequestProperty("Origin", origin);
                }

                if (body != null && !body.isEmpty() && !"GET".equals(method)) {
                    connection.setDoOutput(true);
                    connection.setRequestProperty(
                            "Content-Type",
                            call.getString("contentType", "text/plain; charset=utf-8")
                    );
                    byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
                    connection.setFixedLengthStreamingMode(bytes.length);
                    try (OutputStream output = connection.getOutputStream()) {
                        output.write(bytes);
                    }
                }

                int status = connection.getResponseCode();
                InputStream stream = status >= 400
                        ? connection.getErrorStream()
                        : connection.getInputStream();
                StringBuilder responseBody = new StringBuilder();
                if (stream != null) {
                    try (BufferedReader reader = new BufferedReader(
                            new InputStreamReader(stream, StandardCharsets.UTF_8))) {
                        String line;
                        while ((line = reader.readLine()) != null) {
                            responseBody.append(line).append('\n');
                        }
                    }
                }

                JSObject result = new JSObject();
                result.put("status", status);
                result.put("data", responseBody.toString());
                result.put("url", connection.getURL().toString());
                call.resolve(result);
            } catch (Exception error) {
                call.reject("网络请求失败: " + error.getMessage(), error);
            } finally {
                if (connection != null) connection.disconnect();
            }
        });
    }
}
