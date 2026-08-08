/**
 * 產品介紹表改版 Phase 1 示意資料 seed：
 *   node scripts/seed-product-sheet-demo.mjs          # 建立示意資料
 *   node scripts/seed-product-sheet-demo.mjs --clean  # 依 [DEMO] 前綴一鍵刪除
 *
 * 內容（皆掛 [DEMO] 前綴，真實照片拍好前用來驗證版面）：
 * - 6 筆材種色樣 + 2 筆布墊色樣（程式生成的木紋／織紋漸層 SVG，上傳 material-swatches bucket）
 * - 1 個測試系列「[DEMO] 展示櫃」＋ 4 筆規格（show_on_sheet=true、W/D/H、含一位小數示例），
 *   每筆掛程式生成的矩形線稿 SVG（dimension-drawings bucket），並關聯全部示意色樣
 *
 * 使用 SUPABASE_SERVICE_ROLE_KEY（讀 .env.local），繞過 RLS。
 */
import { createClient } from "@supabase/supabase-js";
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
    /* 檔案不存在時忽略 */
  }
  return out;
}

const env = { ...loadEnv(".env.local"), ...process.env };
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("缺少 NEXT_PUBLIC_SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY（.env.local）");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

const DEMO_PREFIX = "[DEMO]";
const SWATCH_BUCKET = "material-swatches";
const DRAWING_BUCKET = "dimension-drawings";
const PRODUCT_IMAGE_BUCKET = "product-images";

/** 木紋色樣 SVG：縱向漸層 + 半透明紋理線 */
function woodSwatchSvg(base, dark) {
  const grain = Array.from({ length: 14 }, (_, i) => {
    const y = 30 + i * 55 + (i % 3) * 12;
    const wobble = 18 + (i % 4) * 9;
    return `<path d="M0 ${y} Q 200 ${y - wobble}, 400 ${y} T 800 ${y}" stroke="${dark}" stroke-opacity="0.28" stroke-width="${3 + (i % 3)}" fill="none"/>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800">
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="${base}"/><stop offset="0.5" stop-color="${dark}" stop-opacity="0.25"/><stop offset="1" stop-color="${base}"/>
</linearGradient></defs>
<rect width="800" height="800" fill="${base}"/>
<rect width="800" height="800" fill="url(#g)"/>
${grain}
</svg>`;
}

/** 織紋色樣 SVG：底色 + 縱橫細線模擬布面 */
function fabricSwatchSvg(base, dark) {
  const threads = [];
  for (let x = 0; x < 800; x += 16) {
    threads.push(`<line x1="${x}" y1="0" x2="${x}" y2="800" stroke="${dark}" stroke-opacity="0.18" stroke-width="6"/>`);
  }
  for (let y = 0; y < 800; y += 16) {
    threads.push(`<line x1="0" y1="${y}" x2="800" y2="${y}" stroke="${dark}" stroke-opacity="0.14" stroke-width="6"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800">
<rect width="800" height="800" fill="${base}"/>
${threads.join("")}
</svg>`;
}

/** 尺寸線稿 SVG：正視矩形櫃體 + 腳座 + 標註箭頭（黑線白底，模擬 Fusion 360 匯出） */
function dimensionDrawingSvg(label, w, h) {
  const bodyW = 300;
  const bodyH = Math.max(120, Math.min(300, (h / Math.max(w, 1)) * 300 * 0.75));
  const x = 60;
  const y = 40;
  const legH = 46;
  const shelves = [1, 2, 3]
    .map((i) => {
      const sy = y + (bodyH / 4) * i;
      return `<line x1="${x + 10}" y1="${sy}" x2="${x + bodyW - 10}" y2="${sy}" stroke="#000" stroke-width="1.2"/>`;
    })
    .join("");
  const totalH = y + bodyH + legH;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="${totalH + 70}" viewBox="0 0 480 ${totalH + 70}">
<rect width="480" height="${totalH + 70}" fill="#fff"/>
<rect x="${x}" y="${y}" width="${bodyW}" height="${bodyH}" fill="none" stroke="#000" stroke-width="2"/>
<line x1="${x + bodyW / 2}" y1="${y}" x2="${x + bodyW / 2}" y2="${y + bodyH}" stroke="#000" stroke-width="1.2"/>
${shelves}
<line x1="${x + 14}" y1="${y + bodyH}" x2="${x + 14}" y2="${totalH}" stroke="#000" stroke-width="2"/>
<line x1="${x + bodyW - 14}" y1="${y + bodyH}" x2="${x + bodyW - 14}" y2="${totalH}" stroke="#000" stroke-width="2"/>
<line x1="${x}" y1="${totalH + 22}" x2="${x + bodyW}" y2="${totalH + 22}" stroke="#000" stroke-width="1"/>
<line x1="${x}" y1="${totalH + 16}" x2="${x}" y2="${totalH + 28}" stroke="#000" stroke-width="1"/>
<line x1="${x + bodyW}" y1="${totalH + 16}" x2="${x + bodyW}" y2="${totalH + 28}" stroke="#000" stroke-width="1"/>
<text x="${x + bodyW / 2}" y="${totalH + 40}" font-family="sans-serif" font-size="16" text-anchor="middle" fill="#000">W${w}</text>
<line x1="${x + bodyW + 26}" y1="${y}" x2="${x + bodyW + 26}" y2="${totalH}" stroke="#000" stroke-width="1"/>
<line x1="${x + bodyW + 20}" y1="${y}" x2="${x + bodyW + 32}" y2="${y}" stroke="#000" stroke-width="1"/>
<line x1="${x + bodyW + 20}" y1="${totalH}" x2="${x + bodyW + 32}" y2="${totalH}" stroke="#000" stroke-width="1"/>
<text x="${x + bodyW + 44}" y="${y + (totalH - y) / 2}" font-family="sans-serif" font-size="16" fill="#000">H${h}</text>
<text x="${x}" y="24" font-family="sans-serif" font-size="13" fill="#555">${label}（示意線稿）</text>
</svg>`;
}

/** 介紹表第一頁示意主圖 SVG：展示櫃正視示意 */
function heroImageSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900">
<rect width="1200" height="900" fill="#f4f1ec"/>
<g stroke="#3d342b" stroke-width="6" fill="#e6dccb">
<rect x="330" y="140" width="540" height="440"/>
<line x1="600" y1="140" x2="600" y2="580"/>
<line x1="350" y1="255" x2="850" y2="255" stroke-width="3"/>
<line x1="350" y1="370" x2="850" y2="370" stroke-width="3"/>
<line x1="350" y1="485" x2="850" y2="485" stroke-width="3"/>
<line x1="360" y1="580" x2="360" y2="760"/>
<line x1="840" y1="580" x2="840" y2="760"/>
<line x1="340" y1="640" x2="860" y2="640" stroke-width="4"/>
</g>
<text x="600" y="840" font-family="sans-serif" font-size="30" text-anchor="middle" fill="#8a7f70">[DEMO] 展示櫃 示意圖（真實照片拍攝前的版面佔位）</text>
</svg>`;
}

async function uploadSvg(bucket, path, svg) {
  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, Buffer.from(svg, "utf8"), {
      contentType: "image/svg+xml",
      cacheControl: "3600",
      upsert: true,
    });
  if (error) throw new Error(`上傳 ${bucket}/${path} 失敗：${error.message}`);
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

const DEMO_SWATCHES = [
  { file: "demo-wood-natural-white.svg", category: "wood", name: `${DEMO_PREFIX} 白橡木`, name_en: "Oak / Natural white", svg: woodSwatchSvg("#d9c39a", "#a8895c") },
  { file: "demo-wood-snow-white.svg", category: "wood", name: `${DEMO_PREFIX} 雪白橡木`, name_en: "Oak / Snow white", svg: woodSwatchSvg("#eae0cd", "#bfae8f") },
  { file: "demo-wood-medium-grey.svg", category: "wood", name: `${DEMO_PREFIX} 灰橡木`, name_en: "Oak / Medium grey", svg: woodSwatchSvg("#8d8578", "#5d564b") },
  { file: "demo-wood-charcoal.svg", category: "wood", name: `${DEMO_PREFIX} 碳灰橡木`, name_en: "Oak / Charcoal grey", svg: woodSwatchSvg("#4a443c", "#2c2822") },
  { file: "demo-wood-walnut.svg", category: "wood", name: `${DEMO_PREFIX} 胡桃木`, name_en: "Walnut / Beeswax", svg: woodSwatchSvg("#6b4f37", "#412f1f") },
  { file: "demo-wood-tannin-black.svg", category: "wood", name: `${DEMO_PREFIX} 黑檀色`, name_en: "Oak / Tannin black", svg: woodSwatchSvg("#2b2320", "#120e0c") },
  { file: "demo-fabric-sage.svg", category: "fabric", name: `${DEMO_PREFIX} 灰綠布墊`, name_en: "Fabric / Sage", svg: fabricSwatchSvg("#aab3a0", "#77816d") },
  { file: "demo-fabric-sand.svg", category: "fabric", name: `${DEMO_PREFIX} 沙色布墊`, name_en: "Fabric / Sand", svg: fabricSwatchSvg("#c9b9a2", "#99876d") },
];

const DEMO_SERIES_NAME = `${DEMO_PREFIX} 展示櫃`;

const DEMO_VARIANTS = [
  { code: "DEMO-CB01-O", wood: "白橡木", w: 120, d: 45, h: 180, price: 32500, drawing: "demo-drawing-cb01.svg" },
  { code: "DEMO-CB01-W", wood: "胡桃木", w: 120, d: 45, h: 180, price: 35800, drawing: "demo-drawing-cb01.svg" },
  { code: "DEMO-CB02-O", wood: "白橡木", w: 210, d: 45, h: 140, price: 45200, drawing: "demo-drawing-cb02.svg" },
  // 一位小數示例，驗證「小數只在有值時顯示」的版面規則
  { code: "DEMO-CB02-W", wood: "胡桃木", w: 210, d: 45, h: 140.5, price: 48600, drawing: "demo-drawing-cb02.svg" },
];

async function listAll(bucket) {
  const { data, error } = await supabase.storage.from(bucket).list("", { limit: 1000 });
  if (error) return [];
  return (data ?? []).map((f) => f.name);
}

async function clean() {
  console.log("== 刪除 [DEMO] 示意資料 ==");

  // 1) 示意系列（先變體、再關聯、再系列；product_series_swatches 掛 series FK cascade，但 variants 無 cascade）
  const { data: seriesRows } = await supabase
    .from("product_series")
    .select("id, series_name")
    .like("series_name", `${DEMO_PREFIX}%`);
  for (const s of seriesRows ?? []) {
    await supabase.from("product_variants").delete().eq("series_id", s.id);
    const { error } = await supabase.from("product_series").delete().eq("id", s.id);
    console.log(`系列 ${s.series_name}: ${error ? `失敗（${error.message}）` : "已刪除（含規格）"}`);
  }

  // 2) 示意色樣（product_series_swatches 有 swatch FK cascade）
  const { error: swErr, count } = await supabase
    .from("material_swatches")
    .delete({ count: "exact" })
    .like("name", `${DEMO_PREFIX}%`);
  console.log(`色樣：${swErr ? `失敗（${swErr.message}）` : `已刪除 ${count ?? 0} 筆`}`);

  // 3) Storage demo- 檔案
  for (const bucket of [SWATCH_BUCKET, DRAWING_BUCKET, PRODUCT_IMAGE_BUCKET]) {
    const names = (await listAll(bucket)).filter((n) => n.startsWith("demo-"));
    if (names.length) {
      const { error } = await supabase.storage.from(bucket).remove(names);
      console.log(`${bucket}: ${error ? `刪檔失敗（${error.message}）` : `已刪 ${names.length} 檔`}`);
    }
  }
  console.log("完成。");
}

async function seed() {
  console.log("== 建立 [DEMO] 示意資料 ==");

  // 1) 色樣：上傳 SVG → upsert 資料列（以 name 判斷是否已存在）
  const swatchIds = [];
  for (const [i, s] of DEMO_SWATCHES.entries()) {
    const url = await uploadSvg(SWATCH_BUCKET, s.file, s.svg);
    const { data: existing } = await supabase
      .from("material_swatches")
      .select("id")
      .eq("name", s.name)
      .maybeSingle();
    if (existing) {
      await supabase
        .from("material_swatches")
        .update({ category: s.category, name_en: s.name_en, image_url: url, sort_order: 100 + i })
        .eq("id", existing.id);
      swatchIds.push(existing.id);
      console.log(`色樣（更新）：${s.name}`);
    } else {
      const { data, error } = await supabase
        .from("material_swatches")
        .insert({ category: s.category, name: s.name, name_en: s.name_en, image_url: url, sort_order: 100 + i })
        .select("id")
        .single();
      if (error) throw new Error(`色樣 ${s.name} 建立失敗：${error.message}`);
      swatchIds.push(data.id);
      console.log(`色樣：${s.name}`);
    }
  }

  // 2) 測試系列
  const heroUrl = await uploadSvg(PRODUCT_IMAGE_BUCKET, "demo-sheet-hero.svg", heroImageSvg());
  let seriesId;
  const { data: existingSeries } = await supabase
    .from("product_series")
    .select("id")
    .eq("series_name", DEMO_SERIES_NAME)
    .maybeSingle();
  if (existingSeries) {
    seriesId = existingSeries.id;
    console.log(`系列（沿用）：${DEMO_SERIES_NAME}`);
  } else {
    const { data, error } = await supabase
      .from("product_series")
      .insert({
        series_name: DEMO_SERIES_NAME,
        category: "櫃",
        production_time: "6",
        design_concept:
          "延續 museum cabinet 的語彙，為日常生活打造如美術館典藏櫃般的陳列空間。\n\n" +
          "厚實的實木頂板與側板構成安定的量體，捨去多餘裝飾，讓木材的紋理成為唯一的表情。背後的橫拉玻璃門在界定空間的同時，讓光線與反射與被收藏的物件彼此對話。\n\n" +
          "重新調整的比例讓櫃體輪廓更加銳利、洗鍊，自然地融入當代的居住空間。",
        customization_rules: "可依空間訂製尺寸與木種；平日以乾布擦拭，避免陽光直射與潮濕環境。",
        image_url: heroUrl,
        show_price_on_sheet: true,
      })
      .select("id")
      .single();
    if (error) throw new Error(`系列建立失敗：${error.message}`);
    seriesId = data.id;
    console.log(`系列：${DEMO_SERIES_NAME}`);
  }

  // 3) 規格（show_on_sheet=true＋線圖）
  const drawingUrls = {};
  for (const v of DEMO_VARIANTS) {
    if (!drawingUrls[v.drawing]) {
      drawingUrls[v.drawing] = await uploadSvg(
        DRAWING_BUCKET,
        v.drawing,
        dimensionDrawingSvg(v.code.replace(/-[OW]$/, ""), v.w, v.h)
      );
    }
    const { data: existing } = await supabase
      .from("product_variants")
      .select("id")
      .eq("product_code", v.code)
      .is("deleted_at", null)
      .maybeSingle();
    const payload = {
      series_id: seriesId,
      product_code: v.code,
      wood_type: v.wood,
      dimension_w: v.w,
      dimension_d: v.d,
      dimension_h: v.h,
      base_price: v.price,
      show_on_sheet: true,
      dimension_drawing_url: drawingUrls[v.drawing],
    };
    if (existing) {
      await supabase.from("product_variants").update(payload).eq("id", existing.id);
      console.log(`規格（更新）：${v.code}`);
    } else {
      const { error } = await supabase.from("product_variants").insert(payload);
      if (error) throw new Error(`規格 ${v.code} 建立失敗：${error.message}`);
      console.log(`規格：${v.code}`);
    }
  }

  // 4) 系列 ↔ 色樣關聯（整組重寫）
  await supabase.from("product_series_swatches").delete().eq("series_id", seriesId);
  const { error: linkErr } = await supabase.from("product_series_swatches").insert(
    swatchIds.map((swatch_id, i) => ({ series_id: seriesId, swatch_id, sort_order: i }))
  );
  if (linkErr) throw new Error(`色樣關聯失敗：${linkErr.message}`);
  console.log(`已關聯 ${swatchIds.length} 筆色樣到 ${DEMO_SERIES_NAME}`);

  console.log(`完成。介紹表預覽：/print/series/${seriesId}`);
}

const mode = process.argv.includes("--clean") ? "clean" : "seed";
(mode === "clean" ? clean() : seed()).catch((e) => {
  console.error(e);
  process.exit(1);
});
