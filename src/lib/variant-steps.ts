/**
 * 規格逐步挑選：選系列後依選項軸（木種 → 尺寸 → 座墊 → 配置）一步步縮小範圍，
 * 最後得到唯一一筆 product_variants。只是挑選介面，存檔仍是 variant_id。
 *
 * - 步驟由系列實際用到的軸決定：椅＝木種→座墊、櫃／桌＝木種→尺寸（有配置再多一步）。
 * - 每一步只列出前面選擇下真的存在的組合；只剩一個選項的步驟自動帶入。
 * - 系列內有些規格沒有某軸值、有些有（如 CB03 只有 190 有「抽屜置中」）→ 該步多一個「標準」。
 * - 非勾選生成的舊規格與訂製款不走步驟，另列在「其他」。
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseSizeCode } from "@/lib/size-code";

/** 挑選順序＝option_types.sort_order（木種、尺寸、座墊、配置） */
export const VARIANT_AXES = ["wood", "size", "cushion", "config"] as const;
export type VariantAxis = (typeof VARIANT_AXES)[number];

export const VARIANT_AXIS_TITLES: Record<VariantAxis, string> = {
  wood: "木種",
  size: "尺寸",
  cushion: "座墊",
  config: "配置",
};

/** 該軸沒有值（null）的選項 key，顯示為「標準」 */
export const AXIS_NONE = "__none__";
const AXIS_NONE_LABEL = "標準";

export interface AxisValueInfo {
  id: string;
  axis: VariantAxis;
  code: string;
  name: string;
  sort: number;
}

/** 規格的選項軸值（勾選生成的規格才有；全空＝舊資料／手動建立） */
export type VariantAxisValues = Partial<Record<VariantAxis, AxisValueInfo>>;

export interface StepVariant {
  id: string;
  series_id: string | null;
  product_code?: string | null;
  label: string;
  base_price: number | null;
  is_custom_order?: boolean;
  is_deleted?: boolean;
  axis_values?: VariantAxisValues | null;
}

/** 各軸已選的選項 key（option_values.id 或 AXIS_NONE） */
export type AxisChoices = Partial<Record<VariantAxis, string>>;

export interface StepOption {
  key: string;
  label: string;
  /** 補充說明（尺寸代碼與名稱不同時顯示寬深高） */
  hint: string | null;
  /** 選這個選項就能確定唯一一筆規格時的那筆（顯示價格用） */
  variant: StepVariant | null;
}

export interface PickerStep {
  axis: VariantAxis;
  title: string;
  options: StepOption[];
  chosen: string | null;
}

export interface StepState {
  /** 目前要顯示的步驟：到第一個還沒選的步驟為止 */
  steps: PickerStep[];
  /** 所有步驟都選完 */
  complete: boolean;
  /** 符合目前選擇的規格；complete 且只剩 1 筆＝已確定 */
  matches: StepVariant[];
}

/** product_variants 四個軸值欄位 */
export interface AxisValueIdColumns {
  wood_value_id?: string | null;
  size_value_id?: string | null;
  cushion_value_id?: string | null;
  config_value_id?: string | null;
}

/** 讀選項值主檔（option_values＋所屬軸 code），供規格帶入軸值名稱與排序 */
export async function fetchAxisValueMap(
  client: SupabaseClient,
): Promise<Map<string, AxisValueInfo>> {
  const map = new Map<string, AxisValueInfo>();
  const { data, error } = await client
    .from("option_values")
    .select("id, code, name_zh, sort_order, option_types!inner(code)");
  if (error || !data) return map;
  for (const row of data as Array<{
    id: string;
    code: string;
    name_zh: string;
    sort_order: number | null;
    option_types: { code: string } | Array<{ code: string }> | null;
  }>) {
    const type = Array.isArray(row.option_types) ? row.option_types[0] : row.option_types;
    const axis = VARIANT_AXES.find((a) => a === type?.code);
    if (!axis) continue;
    map.set(String(row.id), {
      id: String(row.id),
      axis,
      code: row.code ?? "",
      name: row.name_zh ?? "",
      sort: Number(row.sort_order ?? 0),
    });
  }
  return map;
}

/** 由規格的四個軸值 id 組出軸值資訊；全空回傳 null */
export function axisValuesOf(
  row: AxisValueIdColumns,
  valueMap: Map<string, AxisValueInfo>,
): VariantAxisValues | null {
  const ids: Record<VariantAxis, string | null | undefined> = {
    wood: row.wood_value_id,
    size: row.size_value_id,
    cushion: row.cushion_value_id,
    config: row.config_value_id,
  };
  const out: VariantAxisValues = {};
  let any = false;
  for (const axis of VARIANT_AXES) {
    const id = ids[axis];
    if (!id) continue;
    const info = valueMap.get(String(id));
    if (!info) continue;
    out[axis] = info;
    any = true;
  }
  return any ? out : null;
}

function hasAxisValues(v: StepVariant): boolean {
  return VARIANT_AXES.some((a) => v.axis_values?.[a] != null);
}

function axisKeyOf(v: StepVariant, axis: VariantAxis): string {
  return v.axis_values?.[axis]?.id ?? AXIS_NONE;
}

/**
 * 系列內可挑選的規格：axis＝走步驟的規格；others＝舊規格（依編號）＋訂製款（排最後）。
 * 已刪除規格只在舊明細已選中時保留。
 */
export function splitSeriesVariants<T extends StepVariant>(
  variants: T[],
  seriesId: string | null | undefined,
  selectedId: string | null | undefined,
): { axis: T[]; others: T[] } {
  if (!seriesId) return { axis: [], others: [] };
  const candidates = variants.filter(
    (v) => v.series_id === seriesId && (!v.is_deleted || v.id === selectedId),
  );
  const axis = candidates.filter((v) => !v.is_custom_order && hasAxisValues(v));
  const others = candidates
    .filter((v) => v.is_custom_order || !hasAxisValues(v))
    .sort((a, b) => {
      const ca = a.is_custom_order ? 1 : 0;
      const cb = b.is_custom_order ? 1 : 0;
      if (ca !== cb) return ca - cb;
      return (a.product_code ?? a.label).localeCompare(b.product_code ?? b.label);
    });
  return { axis, others };
}

/** 已選規格回推各軸選擇 */
export function choicesOf(v: StepVariant): AxisChoices {
  const out: AxisChoices = {};
  for (const axis of VARIANT_AXES) out[axis] = axisKeyOf(v, axis);
  return out;
}

function sizeHint(info: AxisValueInfo): string | null {
  const { w, d, h } = parseSizeCode(info.code);
  if (w == null) return null;
  const text = [`W${w}`, d != null ? `D${d}` : null, h != null ? `H${h}` : null]
    .filter(Boolean)
    .join(" ");
  return text.replace(/\s/g, "") === info.name.replace(/\s/g, "") ? null : text;
}

/** 依目前選擇算出要顯示的步驟；選擇不再成立（換了前一步）的後續步驟視為未選 */
export function buildSteps(axisVariants: StepVariant[], choices: AxisChoices): StepState {
  let pool = axisVariants;
  const steps: PickerStep[] = [];
  for (const axis of VARIANT_AXES) {
    const byKey = new Map<string, StepVariant[]>();
    for (const v of pool) {
      const key = axisKeyOf(v, axis);
      const list = byKey.get(key);
      if (list) list.push(v);
      else byKey.set(key, [v]);
    }
    // 這個系列（在前面的選擇下）沒用到此軸 → 跳過
    if (byKey.size === 0 || (byKey.size === 1 && byKey.has(AXIS_NONE))) continue;

    // 「標準」排第一，其餘依 option_values.sort_order
    const options: StepOption[] = Array.from(byKey.entries())
      .map(([key, list]) => {
        const info = key === AXIS_NONE ? null : list[0].axis_values?.[axis] ?? null;
        const option: StepOption = {
          key,
          label: info ? info.name || info.code : AXIS_NONE_LABEL,
          hint: info && axis === "size" ? sizeHint(info) : null,
          variant: list.length === 1 ? list[0] : null,
        };
        return { option, sort: info ? info.sort : -1 };
      })
      .sort((a, b) => a.sort - b.sort || a.option.label.localeCompare(b.option.label))
      .map((x) => x.option);

    const chosenRaw = choices[axis];
    const chosen = chosenRaw != null && byKey.has(chosenRaw) ? chosenRaw : null;
    steps.push({ axis, title: VARIANT_AXIS_TITLES[axis], options, chosen });
    if (chosen == null) return { steps, complete: false, matches: pool };
    pool = byKey.get(chosen) ?? [];
  }
  return { steps, complete: true, matches: pool };
}

function choicesFromSteps(state: StepState): AxisChoices {
  const out: AxisChoices = {};
  for (const s of state.steps) if (s.chosen != null) out[s.axis] = s.chosen;
  return out;
}

/**
 * 點選某一步的選項：保留後續仍成立的選擇、只剩一個選項的步驟自動帶入。
 * variantId＝選完且唯一時的規格，否則 null（尚未選完）。
 */
export function pickAxisValue(
  axisVariants: StepVariant[],
  current: AxisChoices,
  axis: VariantAxis,
  key: string,
): { choices: AxisChoices; variantId: string | null } {
  let next: AxisChoices = { ...current, [axis]: key };
  for (;;) {
    const state = buildSteps(axisVariants, next);
    next = choicesFromSteps(state);
    const last = state.steps[state.steps.length - 1];
    if (!state.complete && last && last.chosen == null && last.options.length === 1) {
      next = { ...next, [last.axis]: last.options[0].key };
      continue;
    }
    const variantId = state.complete && state.matches.length === 1 ? state.matches[0].id : null;
    return { choices: next, variantId };
  }
}

/** 下一個待選步驟的名稱（提示「請選擇座墊」用）；已選完回傳 null */
export function pendingStepTitle(state: StepState): string | null {
  const last = state.steps[state.steps.length - 1];
  if (last && last.chosen == null) return last.title;
  if (state.complete && state.matches.length > 1) return "規格";
  return null;
}

function normalizeSearch(s: string): string {
  return s.toLowerCase().replace(/[\s\-_/·]/g, "");
}

/**
 * 編號快速搜尋：比對產品編號／規格名稱／系列名稱（忽略大小寫、空白與連字號），
 * 編號開頭符合者排前面。
 */
export function searchVariants<T extends StepVariant & { series_name?: string | null }>(
  variants: T[],
  query: string,
  limit = 8,
): T[] {
  const q = normalizeSearch(query);
  if (!q) return [];
  const scored: Array<{ v: T; score: number }> = [];
  for (const v of variants) {
    if (v.is_deleted) continue;
    const code = normalizeSearch(v.product_code ?? "");
    let score = -1;
    if (code.startsWith(q)) score = 0;
    else if (code.includes(q)) score = 1;
    else if (normalizeSearch(`${v.series_name ?? ""}${v.label}`).includes(q)) score = 2;
    if (score >= 0) scored.push({ v, score });
  }
  scored.sort(
    (a, b) =>
      a.score - b.score ||
      (a.v.product_code ?? a.v.label).localeCompare(b.v.product_code ?? b.v.label),
  );
  return scored.slice(0, limit).map((s) => s.v);
}
