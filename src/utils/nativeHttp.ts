import { Capacitor, registerPlugin } from "@capacitor/core";

interface NativeHttpResponse {
  status: number;
  data: string;
  url?: string;
}

interface NativeHttpPlugin {
  request(options: {
    url: string;
    method?: string;
    body?: string;
    connectTimeout?: number;
    readTimeout?: number;
    userAgent?: string;
    accept?: string;
    contentType?: string;
    referer?: string;
    origin?: string;
  }): Promise<NativeHttpResponse>;
}

const NativeHttp = registerPlugin<NativeHttpPlugin>("NativeHttp");

const WECHAT_USER_AGENT =
  "Mozilla/5.0 (Linux; Android 12; wv) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Version/4.0 Chrome/120.0 Mobile Safari/537.36 " +
  "MicroMessenger/8.0 NetType/WIFI Language/zh_CN";

function getNativeUrl(url: string) {
  if (url.startsWith("/api/weixin-long/")) {
    return "https://long.open.weixin.qq.com/" + url.slice("/api/weixin-long/".length);
  }
  if (url.startsWith("/api/weixin/")) {
    return "https://open.weixin.qq.com/" + url.slice("/api/weixin/".length);
  }
  if (url.startsWith("/api/hortor/")) {
    return "https://comb-platform.hortorgames.com/" + url.slice("/api/hortor/".length);
  }
  throw new Error("不支持的接口地址");
}

export async function requestLoginText(
  url: string,
  options: {
    method?: "GET" | "POST";
    body?: string;
    timeout?: number;
    accept?: string;
    contentType?: string;
  } = {},
): Promise<NativeHttpResponse> {
  const method = options.method ?? "GET";
  const timeout = options.timeout ?? 15000;

  if (Capacitor.getPlatform() === "android") {
    return NativeHttp.request({
      url: getNativeUrl(url),
      method,
      body: options.body,
      connectTimeout: timeout,
      readTimeout: timeout,
      userAgent: WECHAT_USER_AGENT,
      accept: options.accept ?? "*/*",
      contentType: options.contentType,
      referer: "https://open.weixin.qq.com/",
      origin: url.startsWith("/api/hortor/") ? "https://open.weixin.qq.com" : undefined,
    });
  }

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url, true);
    xhr.timeout = timeout;
    xhr.setRequestHeader("Accept", options.accept ?? "*/*");
    if (options.contentType) xhr.setRequestHeader("Content-Type", options.contentType);
    xhr.onload = () => resolve({
      status: xhr.status,
      data: xhr.responseText,
      url: xhr.responseURL,
    });
    xhr.onerror = () => reject(new Error("网络连接失败"));
    xhr.ontimeout = () => reject(new Error("请求超时"));
    xhr.send(options.body);
  });
}
