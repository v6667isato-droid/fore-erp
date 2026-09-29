"use client";

import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { NumericInput } from "@/components/ui/numeric-input";
import { VariantSeriesThumb } from "@/components/variant-series-thumb";
import {
  DEFAULT_SEAT_HEIGHT_CM,
  hasSeatSpecs,
} from "@/lib/product-seat-height";
import {
  CUSTOM_ITEM_CATEGORIES,
  CUSTOM_ITEM_SEAT_CATEGORIES,
} from "@/lib/portal-order-rules";
import { cn } from "@/lib/utils";

/** 通路下單可選的規格（product_variants＋所屬系列） */
export interface PortalVariantOption {
  id: string;
  /** product_variants.series_id，供通路折扣計算（與訂單新增一致） */
  series_id: string | null;
  label: string;
  base_price: number | null;
  spec1?: string | null;
  series_category?: string | null;
  seat_height_cm?: number | null;
  /** 示意圖：product_variants.image_url 優先，否則 product_series.image_url */
  series_image_url?: string | null;
  /** 以下供「匯出品項清單 CSV」分欄輸出 */
  series_name: string | null;
  product_code: string | null;
  wood_type: string | null;
  dimension_w: number | null;
  dimension_d: number | null;
  dimension_h: number | null;
  arm_height_cm: number | null;
  /** 規格或所屬系列已軟刪除：不列入挑選清單與匯出，僅舊訂單明細已選中時保留顯示 */
  is_deleted: boolean;
}

/**
 * 明細列類型：
 *   variant 規格庫品項（先選系列、再選品項）
 *   custom  訂製品（客製家具，手填；送出後訂單為「報價中」，由內部回填報價）
 *   locked  內部新增的訂製案例／加工項目（通路端唯讀，編輯時原樣保留）
 */
export type PortalItemKind = "variant" | "custom" | "locked";

export interface PortalItem {
  id: string;
  kind: PortalItemKind;
  /** 系列篩選（僅前端用；編輯既有明細時由規格帶回） */
  series_id: string | null;
  variant_id: string;
  quantity: number;
  /** 牌價快照（規格品選規格時帶入現行牌價；編輯既有明細沿用 order_items.unit_price） */
  unit_price: number;
  /** 通路價快照；null＝無通路價（依牌價結算） */
  channel_unit_price: number | null;
  /** 規格品備註（order_items.custom_notes） */
  notes: string;
  /** 訂單明細約定座高（cm），存入 order_items.seat_height_cm */
  seat_height_cm: number | null;
  /** 編輯既有訂單時的來源 order_items.id；後端據此凍結價格快照 */
  source_item_id: string | null;
  /** 以下為訂製品欄位（custom_* / wood_type） */
  custom_category: string;
  custom_name: string;
  custom_description: string;
  custom_dimension_w: number | null;
  custom_dimension_d: number | null;
  custom_dimension_h: number | null;
  wood_type: string;
}

let portalItemSeq = 0;
function nextPortalItemId(prefix: string): string {
  portalItemSeq += 1;
  return `${prefix}-${Date.now()}-${portalItemSeq}`;
}

export function newPortalVariantItem(prefix = "item"): PortalItem {
  return {
    id: nextPortalItemId(prefix),
    kind: "variant",
    series_id: null,
    variant_id: "",
    quantity: 1,
    unit_price: 0,
    channel_unit_price: null,
    notes: "",
    seat_height_cm: null,
    source_item_id: null,
    custom_category: "",
    custom_name: "",
    custom_description: "",
    custom_dimension_w: null,
    custom_dimension_d: null,
    custom_dimension_h: null,
    wood_type: "",
  };
}

export function movePortalItem(items: PortalItem[], id: string, direction: -1 | 1): PortalItem[] {
  const idx = items.findIndex((x) => x.id === id);
  const next = idx + direction;
  if (idx < 0 || next < 0 || next >= items.length) return items;
  const copy = [...items];
  [copy[idx], copy[next]] = [copy[next], copy[idx]];
  return copy;
}

export function resolvePortalSeatHeight(v: {
  seat_height_cm?: number | null;
  series_category?: string | null;
}): number | null {
  if (v.seat_height_cm != null && Number.isFinite(Number(v.seat_height_cm))) {
    return Number(v.seat_height_cm);
  }
  if (hasSeatSpecs(v.series_category)) return DEFAULT_SEAT_HEIGHT_CM;
  return null;
}

/** 系列通路折扣 %＞0 時之通路結算價 */
export function portalChannelUnitPrice(
  v: PortalVariantOption | undefined,
  discountPctBySeriesId: Map<string, number>
): number | null {
  if (!v?.series_id || v.base_price == null || !Number.isFinite(Number(v.base_price))) return null;
  const pct = discountPctBySeriesId.get(v.series_id) ?? 0;
  if (!(pct > 0)) return null;
  return Math.round(Number(v.base_price) * (1 - pct / 100));
}

export function portalListUnitPrice(v: PortalVariantOption | undefined): number {
  if (v?.base_price == null || !Number.isFinite(Number(v.base_price))) return 0;
  return Number(v.base_price);
}

/** 明細結算單價：通路價優先，否則牌價（訂製品未報價＝0） */
export function portalItemSettlementPrice(it: PortalItem): number {
  return it.channel_unit_price ?? it.unit_price;
}

/** 訂製品是否已由內部回填報價 */
export function isPortalCustomQuoted(it: PortalItem): boolean {
  return it.unit_price > 0 || (it.channel_unit_price ?? 0) > 0;
}

export interface PortalSeriesOption {
  id: string;
  name: string;
  is_deleted: boolean;
}

/** 系列下拉選項：從規格推出唯一系列；系列底下只要還有未刪除的規格就可挑選 */
export function buildPortalSeriesOptions(variants: PortalVariantOption[]): PortalSeriesOption[] {
  const map = new Map<string, { name: string; is_deleted: boolean }>();
  for (const v of variants) {
    if (!v.series_id) continue;
    const prev = map.get(v.series_id);
    map.set(v.series_id, {
      name: v.series_name || prev?.name || "未命名系列",
      is_deleted: (prev?.is_deleted ?? true) && v.is_deleted,
    });
  }
  return Array.from(map.entries()).map(([id, s]) => ({ id, ...s }));
}

/**
 * 送出前整理明細：略過未選規格的空白列；訂製品缺類型／品名時回傳錯誤訊息。
 * 回傳的 payload 交給 /api/portal/orders/create|update（金額由後端重算）。
 */
export function buildPortalItemsPayload(
  items: PortalItem[]
): { ok: true; payload: Record<string, unknown>[]; hasCustom: boolean } | { ok: false; error: string } {
  const payload: Record<string, unknown>[] = [];
  let hasCustom = false;
  for (let i = 0; i < items.length; i += 1) {
    const it = items[i];
    if (it.kind === "locked") {
      payload.push({ kind: "locked", source_item_id: it.source_item_id });
      continue;
    }
    if (it.kind === "custom") {
      if (!it.custom_category || !it.custom_name.trim()) {
        return { ok: false, error: `品項 ${i + 1}（訂製品）請選擇客製類型並填寫品名` };
      }
      hasCustom = true;
      payload.push({
        kind: "custom",
        quantity: it.quantity,
        custom_category: it.custom_category,
        custom_name: it.custom_name.trim(),
        custom_description: it.custom_description,
        custom_dimension_w: it.custom_dimension_w,
        custom_dimension_d: it.custom_dimension_d,
        custom_dimension_h: it.custom_dimension_h,
        wood_type: it.wood_type,
        seat_height_cm: CUSTOM_ITEM_SEAT_CATEGORIES.has(it.custom_category)
          ? it.seat_height_cm
          : null,
        source_item_id: it.source_item_id,
      });
      continue;
    }
    if (!it.variant_id || !(it.quantity > 0)) continue;
    payload.push({
      kind: "variant",
      variant_id: it.variant_id,
      quantity: it.quantity,
      notes: it.notes || "",
      seat_height_cm:
        it.seat_height_cm != null && Number.isFinite(Number(it.seat_height_cm))
          ? Number(it.seat_height_cm)
          : null,
      // 來源明細 id：後端據此比對 variant 未變者沿用原價格快照（金額仍由後端決定）
      source_item_id: it.source_item_id,
    });
  }
  if (payload.length === 0) {
    return { ok: false, error: "請至少新增一筆有效品項（選擇規格品，或填寫訂製品）" };
  }
  return { ok: true, payload, hasCustom };
}

/** 訂製品木種常用選項（仍可自行輸入其他木種） */
const PORTAL_CUSTOM_WOOD_OPTIONS = ["白橡木", "胡桃木", "煙燻白橡木"] as const;

const fieldCls =
  "h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring";
const labelCls = "text-xs text-muted-foreground";

function PriceBox({ label, value, dashed = false }: { label: string; value: number | null; dashed?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className={labelCls}>{label}</span>
      <div
        className={cn(
          "flex h-9 items-center justify-end rounded-md border px-3 text-sm tabular-nums text-muted-foreground",
          dashed ? "border-dashed border-border bg-muted/40" : "border-input bg-muted/30"
        )}
      >
        {value != null && value > 0 ? `$${value.toLocaleString()}` : "—"}
      </div>
    </div>
  );
}

/** 單筆明細卡片（通路下單與編輯訂單共用） */
export function PortalItemCard({
  item,
  index,
  total,
  variants,
  seriesOptions,
  discountPctBySeriesId,
  onChange,
  onRemove,
  onMove,
}: {
  item: PortalItem;
  index: number;
  total: number;
  variants: PortalVariantOption[];
  seriesOptions: PortalSeriesOption[];
  discountPctBySeriesId: Map<string, number>;
  onChange: (patch: Partial<PortalItem>) => void;
  onRemove: () => void;
  onMove: (direction: -1 | 1) => void;
}) {
  const it = item;

  /**
   * 切換品項類型：兩類欄位分開存放，切回來時原本填的內容還在；
   * 價格依新類型重帶（規格品＝所選規格現價，訂製品＝待報價）。
   */
  function switchKind(kind: "variant" | "custom") {
    if (kind === it.kind) return;
    if (kind === "custom") {
      onChange({ kind, unit_price: 0, channel_unit_price: null });
      return;
    }
    const v = variants.find((x) => x.id === it.variant_id);
    onChange({
      kind,
      unit_price: portalListUnitPrice(v),
      channel_unit_price: portalChannelUnitPrice(v, discountPctBySeriesId),
    });
  }

  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3 sm:p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">品項 {index + 1}</span>
          {it.kind === "locked" ? (
            <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[11px] text-muted-foreground">
              內部新增
            </span>
          ) : (
            <div className="flex items-center gap-1" role="group" aria-label="品項類型">
              {(
                [
                  ["variant", "規格品"],
                  ["custom", "訂製品"],
                ] as const
              ).map(([kind, label]) => (
                <button
                  key={kind}
                  type="button"
                  aria-pressed={it.kind === kind}
                  onClick={() => switchKind(kind)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    it.kind === kind
                      ? "border-primary bg-primary/10 font-medium text-primary"
                      : "border-border bg-background text-muted-foreground hover:text-foreground"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
        {total > 1 ? (
          <div className="flex items-center gap-1">
            <button
              type="button"
              title="上移"
              aria-label="上移"
              disabled={index === 0}
              onClick={() => onMove(-1)}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:bg-accent disabled:pointer-events-none disabled:opacity-40"
            >
              <ArrowUp className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              title="下移"
              aria-label="下移"
              disabled={index === total - 1}
              onClick={() => onMove(1)}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:bg-accent disabled:pointer-events-none disabled:opacity-40"
            >
              <ArrowDown className="h-3.5 w-3.5" />
            </button>
            {it.kind !== "locked" ? (
              <button
                type="button"
                onClick={onRemove}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-destructive focus:outline-none focus:ring-2 focus:ring-ring"
                aria-label="移除"
                title="移除"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {it.kind === "variant" ? (
        <PortalVariantFields
          item={it}
          variants={variants}
          seriesOptions={seriesOptions}
          discountPctBySeriesId={discountPctBySeriesId}
          onChange={onChange}
        />
      ) : it.kind === "custom" ? (
        <PortalCustomFields item={it} onChange={onChange} />
      ) : (
        <PortalLockedFields item={it} />
      )}
    </div>
  );
}

function PortalVariantFields({
  item: it,
  variants,
  seriesOptions,
  discountPctBySeriesId,
  onChange,
}: {
  item: PortalItem;
  variants: PortalVariantOption[];
  seriesOptions: PortalSeriesOption[];
  discountPctBySeriesId: Map<string, number>;
  onChange: (patch: Partial<PortalItem>) => void;
}) {
  const selected = variants.find((v) => v.id === it.variant_id);
  const pickable = variants.filter(
    (v) =>
      // 已刪除品項只在舊明細已選中時保留，避免出現在挑選清單
      (!v.is_deleted || v.id === it.variant_id) &&
      (it.series_id ? v.series_id === it.series_id : true)
  );

  function selectVariant(variantId: string) {
    if (variantId === it.variant_id) return;
    const v = variants.find((x) => x.id === variantId);
    // 主動改選規格＝依現行牌價／通路折扣重新帶入（既有明細未改選者維持快照，見 orders/update API）
    onChange({
      variant_id: variantId,
      series_id: v?.series_id ?? it.series_id,
      unit_price: portalListUnitPrice(v),
      channel_unit_price: portalChannelUnitPrice(v, discountPctBySeriesId),
      seat_height_cm: v ? resolvePortalSeatHeight(v) : null,
    });
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <label className={labelCls} htmlFor={`portal-series-${it.id}`}>
            系列
          </label>
          <select
            id={`portal-series-${it.id}`}
            value={it.series_id ?? ""}
            onChange={(e) =>
              // 重選系列時先清空品項（比照 ERP 開單）
              onChange({
                series_id: e.target.value || null,
                variant_id: "",
                unit_price: 0,
                channel_unit_price: null,
              })
            }
            className={fieldCls}
          >
            <option value="">全部系列</option>
            {seriesOptions
              .filter((s) => !s.is_deleted || s.id === it.series_id)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </select>
        </div>
        <div className="flex min-w-0 flex-col gap-1.5 sm:col-span-2">
          <label className={labelCls} htmlFor={`portal-variant-${it.id}`}>
            品項 *
          </label>
          <select
            id={`portal-variant-${it.id}`}
            value={it.variant_id}
            onChange={(e) => selectVariant(e.target.value)}
            className={fieldCls}
          >
            <option value="">請選擇</option>
            {pickable.map((v) => (
              <option key={v.id} value={v.id}>
                {/* 已選系列時不重複系列名，選單較短（手機好讀） */}
                {!it.series_id && v.series_name ? `${v.series_name} / ${v.label}` : v.label}
                {v.base_price != null ? ` · $${v.base_price}` : ""}
              </option>
            ))}
          </select>
          <VariantSeriesThumb
            imageUrl={selected?.series_image_url}
            compactPlaceholder
            sizeClassName="h-10 w-10 sm:h-11 sm:w-11"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <label className={labelCls}>數量 *</label>
          <NumericInput
            value={it.quantity}
            onValueChange={(v) => onChange({ quantity: Math.max(1, v ?? 1) })}
            className="w-full"
          />
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <label className={labelCls}>座高（cm）</label>
          <NumericInput
            step="0.1"
            value={it.seat_height_cm ?? ""}
            allowDecimal
            onValueChange={(v) => onChange({ seat_height_cm: v })}
            placeholder={`預設 ${DEFAULT_SEAT_HEIGHT_CM}`}
            className="w-full"
          />
        </div>
        {it.variant_id ? (
          <>
            <PriceBox label="牌價" value={it.unit_price} />
            <PriceBox label="通路價格" value={it.channel_unit_price} dashed />
          </>
        ) : null}
      </div>
      <div className="flex flex-col gap-1.5">
        <label className={labelCls}>備註</label>
        <input
          type="text"
          value={it.notes}
          onChange={(e) => onChange({ notes: e.target.value })}
          placeholder={`標準座高 ${DEFAULT_SEAT_HEIGHT_CM}cm；加高請註明（另計增高費）、布墊等`}
          className={fieldCls}
        />
      </div>
    </div>
  );
}

function PortalCustomFields({
  item: it,
  onChange,
}: {
  item: PortalItem;
  onChange: (patch: Partial<PortalItem>) => void;
}) {
  const categories: string[] = [...CUSTOM_ITEM_CATEGORIES];
  // 舊資料若有不在清單內的類別，保留為選項避免被清掉
  if (it.custom_category && !categories.includes(it.custom_category)) {
    categories.push(it.custom_category);
  }
  const showSeat = CUSTOM_ITEM_SEAT_CATEGORIES.has(it.custom_category);
  const quoted = isPortalCustomQuoted(it);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <label className={labelCls} htmlFor={`portal-custom-cat-${it.id}`}>
            客製類型 *
          </label>
          <select
            id={`portal-custom-cat-${it.id}`}
            value={it.custom_category}
            onChange={(e) => onChange({ custom_category: e.target.value })}
            className={fieldCls}
          >
            <option value="">請選擇</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className="flex min-w-0 flex-col gap-1.5 sm:col-span-2">
          <label className={labelCls} htmlFor={`portal-custom-name-${it.id}`}>
            品名 *
          </label>
          <input
            id={`portal-custom-name-${it.id}`}
            type="text"
            value={it.custom_name}
            onChange={(e) => onChange({ custom_name: e.target.value })}
            placeholder="例如：實木餐桌、電視櫃"
            className={fieldCls}
          />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {(
          [
            ["custom_dimension_w", "寬 W（cm）"],
            ["custom_dimension_d", "深 D（cm）"],
            ["custom_dimension_h", "高 H（cm）"],
          ] as const
        ).map(([key, label]) => (
          <div key={key} className="flex min-w-0 flex-col gap-1.5">
            <label className={labelCls}>{label}</label>
            <NumericInput
              value={it[key] ?? ""}
              allowDecimal
              onValueChange={(v) => onChange({ [key]: v } as Partial<PortalItem>)}
              placeholder="—"
              className="w-full"
            />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="col-span-2 flex min-w-0 flex-col gap-1.5">
          <label className={labelCls} htmlFor={`portal-custom-wood-${it.id}`}>
            木種／材質
          </label>
          {/* datalist：可從常用木種挑選，也可自行輸入 */}
          <input
            id={`portal-custom-wood-${it.id}`}
            type="text"
            list={`portal-custom-wood-list-${it.id}`}
            value={it.wood_type}
            onChange={(e) => onChange({ wood_type: e.target.value })}
            placeholder="選擇或輸入木種"
            autoComplete="off"
            className={fieldCls}
          />
          <datalist id={`portal-custom-wood-list-${it.id}`}>
            {PORTAL_CUSTOM_WOOD_OPTIONS.map((w) => (
              <option key={w} value={w} />
            ))}
          </datalist>
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <label className={labelCls}>數量 *</label>
          <NumericInput
            value={it.quantity}
            onValueChange={(v) => onChange({ quantity: Math.max(1, v ?? 1) })}
            className="w-full"
          />
        </div>
        {showSeat ? (
          <div className="flex min-w-0 flex-col gap-1.5">
            <label className={labelCls}>座高（cm）</label>
            <NumericInput
              value={it.seat_height_cm ?? ""}
              allowDecimal
              onValueChange={(v) => onChange({ seat_height_cm: v })}
              placeholder={`預設 ${DEFAULT_SEAT_HEIGHT_CM}`}
              className="w-full"
            />
          </div>
        ) : null}
      </div>
      {quoted ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <PriceBox label="牌價" value={it.unit_price} />
          <PriceBox label="通路價格" value={it.channel_unit_price} dashed />
        </div>
      ) : (
        <p className="rounded-md border border-dashed border-border bg-background px-3 py-2 text-xs text-muted-foreground">
          價格：<span className="font-medium text-foreground">待報價</span>
          。送出後訂單為「報價中」，我們報價後會回填金額。
        </p>
      )}
      <div className="flex flex-col gap-1.5">
        <label className={labelCls} htmlFor={`portal-custom-desc-${it.id}`}>
          詳細說明
        </label>
        <textarea
          id={`portal-custom-desc-${it.id}`}
          value={it.custom_description}
          onChange={(e) => onChange({ custom_description: e.target.value })}
          placeholder={"造型、用途、五金、塗裝等需求\n尺寸圖或參考照片請於下方「製作圖」上傳"}
          className="min-h-[88px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>
    </div>
  );
}

function PortalLockedFields({ item: it }: { item: PortalItem }) {
  return (
    <div className="space-y-2 text-sm">
      <p className="font-medium text-foreground [overflow-wrap:anywhere]">
        {it.custom_name.trim() || "內部新增品項"}
        <span className="ml-2 tabular-nums text-muted-foreground">× {it.quantity}</span>
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <PriceBox label="牌價" value={it.unit_price} />
        <PriceBox label="通路價格" value={it.channel_unit_price} dashed />
      </div>
      <p className="text-xs text-muted-foreground">此品項由我們新增，無法於此修改；如需調整請與我們聯繫。</p>
    </div>
  );
}
