import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// 本專案頁面皆為動態（Supabase 客端渲染），未使用 ISR/快取，維持預設即可
export default defineCloudflareConfig();
