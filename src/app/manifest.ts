import type { MetadataRoute } from "next";

/**
 * PWA manifest（/manifest.webmanifest）：讓 Chrome／Edge 可「安裝應用程式」成桌面捷徑、
 * Android／iOS 可「加入主畫面」，以獨立視窗開啟（沒有網址列與分頁）。
 * start_url 用 "/"：未登入會導向 /login，員工登入後會導向 /employee/dashboard。
 * 刻意不註冊 service worker：ERP 資料需即時，避免離線快取到舊畫面。
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Føre Furniture ERP",
    short_name: "Føre ERP",
    description: "Føre Furniture 工坊管理系統",
    lang: "zh-TW",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#faf7f2",
    theme_color: "#faf7f2",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
