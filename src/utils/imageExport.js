import { saveBlobAsFile } from "@/utils/fileExport";
import html2canvas from "html2canvas";

const FULL_EXPORT_CONTAINERS = [
  ".style1-table-container",
  ".style2-table-wrapper",
  ".members-table-wrapper",
  ".god-ranking-content",
  ".n-data-table",
  ".n-data-table-wrapper",
  ".n-data-table-base-table",
  ".n-data-table-base-table-body",
  ".n-scrollbar-container",
  ".n-scrollbar-content",
];

export async function renderFullElementToCanvas(element, options = {}) {
  if (!element) throw new Error("未找到要导出的内容");

  const expandedElements = [
    element,
    ...element.querySelectorAll(FULL_EXPORT_CONTAINERS.join(",")),
  ];
  const originalStyles = expandedElements.map((item) => ({
    item,
    style: item.getAttribute("style"),
  }));

  try {
    const exportWidth = Math.max(
      element.scrollWidth,
      element.offsetWidth,
      ...expandedElements.map((item) => item.scrollWidth || 0),
    );

    element.classList.add("battle-export-layout");
    element.style.width = `${exportWidth}px`;
    element.style.maxWidth = "none";
    element.style.overflow = "visible";

    expandedElements.slice(1).forEach((item) => {
      item.style.maxWidth = "none";
      item.style.maxHeight = "none";
      item.style.overflow = "visible";
    });

    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    return await html2canvas(element, {
      scale: 2,
      useCORS: true,
      allowTaint: false,
      backgroundColor: "#ffffff",
      logging: false,
      width: Math.ceil(element.scrollWidth),
      height: Math.ceil(element.scrollHeight),
      windowWidth: Math.ceil(element.scrollWidth),
      windowHeight: Math.ceil(element.scrollHeight),
      scrollX: 0,
      scrollY: 0,
      ...options,
    });
  } finally {
    element.classList.remove("battle-export-layout");
    originalStyles.forEach(({ item, style }) => {
      if (style === null) item.removeAttribute("style");
      else item.setAttribute("style", style);
    });
  }
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    if (!canvas.toBlob) {
      fetch(canvas.toDataURL("image/png"))
        .then((response) => response.blob())
        .then(resolve, reject);
      return;
    }
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Canvas 转换图片失败"))),
      "image/png",
    );
  });
}

export async function downloadCanvasAsImage(canvas, filename) {
  const blob = await canvasToBlob(canvas);
  return saveBlobAsFile(blob, filename, "image/png");
}
