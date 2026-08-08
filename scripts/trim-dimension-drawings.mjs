/**
 * 裁切既有尺寸線圖 PNG 的四周留白（Fusion 360 匯出常是整張大畫布）：
 *   node scripts/trim-dimension-drawings.mjs
 *
 * 對所有 product_variants.dimension_drawing_url 為 .png 的檔案：
 * 下載 → 掃非白像素外框 → 加 2% 邊距裁切 → 以新檔名上傳（避免 CDN 快取舊圖）
 * → 更新引用該 URL 的所有 variants → 刪除舊檔。
 * 已幾乎滿版（裁不到 3%）的檔案跳過。demo- 開頭的示意檔跳過。
 * 前端上傳元件已內建同樣的自動裁切，此 script 只需對「加裁切功能前」上傳的舊圖跑一次。
 */
import { createClient } from "@supabase/supabase-js";
import { PNG } from "pngjs";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv(file) {
  const out = {};
  try {
    for (const line of readFileSync(resolve(root, file), "utf8").split(/\r?\n/)) {
      const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!m) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      out[m[1]] = v;
    }
  } catch {
    /* ignore */
  }
  return out;
}

const env = { ...loadEnv(".env.local"), ...process.env };
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const BUCKET = "dimension-drawings";

/** 與前端 trimPngWhitespace 相同規則：非透明且非近白（RGB 皆 >247 視為白） */
function trimPng(buffer) {
  const png = PNG.sync.read(buffer);
  const { width: w, height: h, data } = png;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const ink = data[i + 3] > 16 && !(data[i] > 247 && data[i + 1] > 247 && data[i + 2] > 247);
      if (ink) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null; // 全白
  const pad = Math.round(Math.max(w, h) * 0.02) + 4;
  const cx = Math.max(0, minX - pad);
  const cy = Math.max(0, minY - pad);
  const cw = Math.min(w, maxX + pad + 1) - cx;
  const ch = Math.min(h, maxY + pad + 1) - cy;
  if (cw >= w * 0.97 && ch >= h * 0.97) return null; // 已滿版，不必裁

  const out = new PNG({ width: cw, height: ch });
  PNG.bitblt(png, out, cx, cy, cw, ch, 0, 0);
  return { buffer: PNG.sync.write(out), from: `${w}×${h}`, to: `${cw}×${ch}` };
}

const { data: variants, error } = await supabase
  .from("product_variants")
  .select("id, product_code, dimension_drawing_url")
  .is("deleted_at", null)
  .not("dimension_drawing_url", "is", null);
if (error) {
  console.error("讀取 variants 失敗：", error.message);
  process.exit(1);
}

/** 同一張圖可能被多個 variants 引用：以 URL 分組處理一次 */
const byUrl = new Map();
for (const v of variants) {
  const url = v.dimension_drawing_url;
  if (!/\.png$/i.test(url)) continue;
  const path = url.split(`/object/public/${BUCKET}/`)[1];
  if (!path || path.startsWith("demo-")) continue;
  if (!byUrl.has(url)) byUrl.set(url, { path, codes: [] });
  byUrl.get(url).codes.push(v.product_code);
}

if (byUrl.size === 0) {
  console.log("沒有需要處理的 PNG 線圖。");
  process.exit(0);
}

for (const [url, { path, codes }] of byUrl) {
  const res = await fetch(url);
  if (!res.ok) {
    console.log(`${codes.join(", ")}: 下載失敗（${res.status}），跳過`);
    continue;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  let trimmed;
  try {
    trimmed = trimPng(buf);
  } catch (e) {
    console.log(`${codes.join(", ")}: 解析失敗（${e.message}），跳過`);
    continue;
  }
  if (!trimmed) {
    console.log(`${codes.join(", ")}: 已滿版或全白，跳過`);
    continue;
  }

  const newPath = `${randomUUID()}.png`;
  const up = await supabase.storage.from(BUCKET).upload(newPath, trimmed.buffer, {
    contentType: "image/png",
    cacheControl: "3600",
  });
  if (up.error) {
    console.log(`${codes.join(", ")}: 上傳失敗（${up.error.message}），跳過`);
    continue;
  }
  const newUrl = supabase.storage.from(BUCKET).getPublicUrl(newPath).data.publicUrl;
  const upd = await supabase
    .from("product_variants")
    .update({ dimension_drawing_url: newUrl })
    .eq("dimension_drawing_url", url);
  if (upd.error) {
    console.log(`${codes.join(", ")}: 更新資料失敗（${upd.error.message}）`);
    continue;
  }
  await supabase.storage.from(BUCKET).remove([path]);
  console.log(`${codes.join(", ")}: ${trimmed.from} → ${trimmed.to} 已裁切`);
}
console.log("完成。");
