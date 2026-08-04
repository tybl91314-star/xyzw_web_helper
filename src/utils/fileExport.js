import { Capacitor, registerPlugin } from "@capacitor/core";

const NativeFileSave = registerPlugin("NativeFileSave");

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(reader.error || new Error("文件读取失败"));
    reader.readAsDataURL(blob);
  });
}

function downloadInBrowser(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function saveBlobAsFile(blob, filename, mimeType = blob.type) {
  if (Capacitor.isNativePlatform()) {
    const data = await blobToBase64(blob);
    const result = await NativeFileSave.saveFile({
      data,
      filename,
      mimeType: mimeType || "application/octet-stream",
    });
    if (!result?.saved) throw new Error("未保存文件");
    return result;
  }

  downloadInBrowser(blob, filename);
  return { saved: true };
}
