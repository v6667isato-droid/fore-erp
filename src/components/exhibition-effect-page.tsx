"use client";

import { useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Link2, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { fetchAllRows } from "@/lib/fetch-all-rows";
import { Button } from "@/components/ui/button";
import { NumericInput } from "@/components/ui/numeric-input";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  computeExhibitionEffects,
  defaultCustomerSourceFor,
  EXHIBITION_COST_ITEM_PRESETS,
  EXHIBITION_CUSTOMER_SOURCES,
  EXHIBITION_NAME_PRESETS,
  EXHIBITION_PURCHASE_SELECT,
  EXHIBITION_SELECT,
  exhibitionLabel,
  isLikelyExhibitionPurchase,
  mapExhibitionPurchase,
  purchaseCandidateRange,
  purchaseCostAmount,
  type EffectCustomerInput,
  type EffectOrderInput,
  type ExhibitionCostRow,
  type ExhibitionPurchaseRow,
  type ExhibitionRow,
} from "@/lib/exhibitions";

type OrderRowWithDeleted = EffectOrderInput & { deleted_at: string | null };

function formatMoney(value: number): string {
  return Math.round(value).toLocaleString("zh-TW");
}

function formatMd(ymd: string): string {
  return `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`;
}

const inputClass =
  "h-9 w-full rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring";
const labelClass = "text-xs text-muted-foreground";

/**
 * 成本統計頁「展覽效益」分頁：各展覽場次的現場成交、展後轉單、參展成本與效益比較。
 * 場次與成本在此維護；成交依客戶來源與下單日推算，訂單不另外標記場次。
 */
export function ExhibitionEffectPage() {
  const [loading, setLoading] = useState(true);
  const [exhibitions, setExhibitions] = useState<ExhibitionRow[]>([]);
  const [costs, setCosts] = useState<ExhibitionCostRow[]>([]);
  const [orders, setOrders] = useState<EffectOrderInput[]>([]);
  const [customers, setCustomers] = useState<EffectCustomerInput[]>([]);
  /** 已連結到展覽的採購品項 */
  const [purchases, setPurchases] = useState<ExhibitionPurchaseRow[]>([]);
  const [editing, setEditing] = useState<ExhibitionRow | "new" | null>(null);

  /** 儲存場次後 +1 觸發重新讀取 */
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [exRes, costRes, orderRes, customerRes, purchaseRes] = await Promise.all([
        supabase.from("exhibitions").select(EXHIBITION_SELECT).order("start_date", { ascending: false }),
        supabase
          .from("exhibition_costs")
          .select("id, exhibition_id, item, amount, notes, sort_order")
          .order("sort_order", { ascending: true }),
        fetchAllRows<OrderRowWithDeleted>(
          "orders",
          "id, order_date, customer_id, status, total_amount, shipping_fee, tax_extra_amount, deleted_at",
        ),
        fetchAllRows<EffectCustomerInput>("customers", "id, source, customer_type"),
        supabase
          .from("purchases")
          .select(EXHIBITION_PURCHASE_SELECT)
          .not("exhibition_id", "is", null)
          .is("deleted_at", null)
          .order("purchase_date", { ascending: true }),
      ]);
      if (cancelled) return;
      const error =
        exRes.error?.message ??
        costRes.error?.message ??
        orderRes.error ??
        customerRes.error ??
        purchaseRes.error?.message;
      if (error) toast.error(`展覽效益讀取失敗：${error}`);
      setExhibitions((exRes.data ?? []) as ExhibitionRow[]);
      setCosts(
        ((costRes.data ?? []) as ExhibitionCostRow[]).map((c) => ({ ...c, amount: Number(c.amount) || 0 })),
      );
      setOrders(orderRes.rows.filter((o) => o.deleted_at == null));
      setCustomers(customerRes.rows);
      setPurchases(((purchaseRes.data ?? []) as Record<string, unknown>[]).map(mapExhibitionPurchase));
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const effects = useMemo(
    () => computeExhibitionEffects(exhibitions, costs, orders, customers, purchases),
    [exhibitions, costs, orders, customers, purchases],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <h2 className="text-base font-semibold text-foreground">展覽效益</h2>
          <p className="max-w-3xl text-xs leading-relaxed text-muted-foreground">
            統計客戶來源為該展的訂單：展期內下單（含散客代表客戶）算現場成交，展期結束後到下一屆同展開始前算展後轉單。
            營收為未稅、不含運費，排除「報價中」與「已退貨」。新客＝首次成交在本屆開始之後的客人。
          </p>
        </div>
        <Button type="button" onClick={() => setEditing("new")}>
          <Plus className="h-4 w-4" />
          新增場次
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          讀取中…
        </div>
      ) : effects.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          尚未建立展覽場次。按「新增場次」建立第一場（例如 2026 木質生活展），並填入展期與成本。
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">場次</th>
                <th className="px-3 py-2 text-right font-medium">現場成交</th>
                <th className="px-3 py-2 text-right font-medium">展後轉單</th>
                <th className="px-3 py-2 text-right font-medium">營收合計</th>
                <th className="px-3 py-2 text-right font-medium">新客</th>
                <th className="px-3 py-2 text-right font-medium">成本</th>
                <th className="px-3 py-2 text-right font-medium">營收÷成本</th>
                <th className="px-3 py-2 text-right font-medium">每位新客成本</th>
                <th className="px-3 py-2 text-right font-medium">平均客單價</th>
                <th className="px-3 py-2" aria-label="操作" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {effects.map((f) => {
                const e = f.exhibition;
                return (
                  <tr key={e.id} className="align-top">
                    <td className="px-3 py-2.5">
                      <div className="font-medium text-foreground">{exhibitionLabel(e)}</div>
                      <div className="text-xs text-muted-foreground">
                        {formatMd(e.start_date)}–{formatMd(e.end_date)}
                        {e.location ? ` · ${e.location}` : ""}
                      </div>
                      <div className="text-[11px] text-muted-foreground/80">
                        {e.customer_source
                          ? `統計${f.windowEnd ? `至 ${f.windowEnd.replace(/-/g, "/")} 前` : "至今"}`
                          : "未對應客戶來源，無法統計成交"}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      <div>{formatMoney(f.onsiteRevenue)}</div>
                      <div className="text-xs text-muted-foreground">
                        {f.onsiteOrders} 張{f.onsiteWalkInOrders > 0 ? `（散客 ${f.onsiteWalkInOrders}）` : ""}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      <div>{formatMoney(f.postShowRevenue)}</div>
                      <div className="text-xs text-muted-foreground">
                        {f.postShowOrders} 張／{f.postShowCustomers} 位
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-foreground">
                      {formatMoney(f.totalRevenue)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{f.newCustomers}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {f.cost > 0 ? formatMoney(f.cost) : <span className="text-xs text-muted-foreground">未填</span>}
                      {f.purchaseCount > 0 ? (
                        <div className="text-xs text-muted-foreground">採購 {f.purchaseCount} 筆</div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {f.revenuePerCost != null ? `${f.revenuePerCost.toFixed(1)} 倍` : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {f.costPerNewCustomer != null ? formatMoney(f.costPerNewCustomer) : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {f.avgOrderValue != null ? formatMoney(f.avgOrderValue) : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="h-8 w-8"
                        title="編輯場次與成本"
                        onClick={() => setEditing(e)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <ExhibitionFormDialog
        key={editing === null ? "closed" : editing === "new" ? "new" : editing.id}
        target={editing}
        costs={editing && editing !== "new" ? costs.filter((c) => c.exhibition_id === editing.id) : []}
        linkedPurchases={
          editing && editing !== "new" ? purchases.filter((p) => p.exhibition_id === editing.id) : []
        }
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          setReloadKey((k) => k + 1);
        }}
      />
    </div>
  );
}

type CostDraft = { key: string; item: string; amount: number };

function ExhibitionFormDialog({
  target,
  costs,
  linkedPurchases,
  onClose,
  onSaved,
}: {
  target: ExhibitionRow | "new" | null;
  costs: ExhibitionCostRow[];
  linkedPurchases: ExhibitionPurchaseRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const existing = target && target !== "new" ? target : null;
  const [name, setName] = useState(existing?.name ?? "");
  const [startDate, setStartDate] = useState(existing?.start_date ?? "");
  const [endDate, setEndDate] = useState(existing?.end_date ?? "");
  const [location, setLocation] = useState(existing?.location ?? "");
  const [customerSource, setCustomerSource] = useState(existing?.customer_source ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [costLines, setCostLines] = useState<CostDraft[]>(() =>
    costs.map((c) => ({ key: c.id, item: c.item, amount: c.amount })),
  );
  const [linked, setLinked] = useState<ExhibitionPurchaseRow[]>(linkedPurchases);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // 從採購連結：列出展前 180 天～展後 60 天、尚未連結其他展覽的採購品項
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [candidates, setCandidates] = useState<ExhibitionPurchaseRow[]>([]);
  const [pickerSearch, setPickerSearch] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const otherTotal = costLines.reduce((s, c) => s + (c.amount || 0), 0);
  const purchaseTotal = linked.reduce((s, p) => s + purchaseCostAmount(p), 0);

  async function openPicker() {
    if (!startDate || !endDate) return void toast.error("請先填寫展期，才能列出這段期間的採購");
    setPickerOpen(true);
    setPickerLoading(true);
    setPicked(new Set());
    setPickerSearch("");
    const { from, to } = purchaseCandidateRange(startDate, endDate);
    let query = supabase
      .from("purchases")
      .select(EXHIBITION_PURCHASE_SELECT)
      .is("deleted_at", null)
      .gte("purchase_date", from)
      .lte("purchase_date", to)
      .order("purchase_date", { ascending: false })
      .limit(500);
    query = existing
      ? query.or(`exhibition_id.is.null,exhibition_id.eq.${existing.id}`)
      : query.is("exhibition_id", null);
    const { data, error } = await query;
    setPickerLoading(false);
    if (error) return void toast.error(`採購讀取失敗：${error.message}`);
    const linkedIds = new Set(linked.map((p) => p.id));
    const rows = ((data ?? []) as Record<string, unknown>[])
      .map(mapExhibitionPurchase)
      .filter((p) => !linkedIds.has(p.id));
    // 看起來像展覽支出的排前面，其餘依日期新到舊
    rows.sort((a, b) => Number(isLikelyExhibitionPurchase(b)) - Number(isLikelyExhibitionPurchase(a)));
    setCandidates(rows);
  }

  const visibleCandidates = useMemo(() => {
    const q = pickerSearch.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter((p) =>
      [p.item_name, p.vendor_name, p.item_category, p.po_number, p.po_notes]
        .filter(Boolean)
        .some((t) => String(t).toLowerCase().includes(q)),
    );
  }, [candidates, pickerSearch]);

  function linkPicked() {
    setLinked((prev) =>
      [...prev, ...candidates.filter((p) => picked.has(p.id))].sort((a, b) =>
        a.purchase_date.localeCompare(b.purchase_date),
      ),
    );
    setPickerOpen(false);
  }

  async function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!name.trim()) return void toast.error("請填寫展名");
    if (!startDate || !endDate) return void toast.error("請填寫展期起訖日");
    if (endDate < startDate) return void toast.error("結束日不可早於開始日");

    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        start_date: startDate,
        end_date: endDate,
        location: location.trim() || null,
        customer_source: customerSource || null,
        notes: notes.trim() || null,
      };
      let id = existing?.id ?? null;
      if (id) {
        const { error } = await supabase.from("exhibitions").update(payload).eq("id", id);
        if (error) return void toast.error(error.message);
        const { error: delErr } = await supabase.from("exhibition_costs").delete().eq("exhibition_id", id);
        if (delErr) return void toast.error(delErr.message);
      } else {
        const { data, error } = await supabase.from("exhibitions").insert(payload).select("id").single();
        if (error || !data) return void toast.error(error?.message ?? "建立場次失敗");
        id = data.id as string;
      }
      const costPayload = costLines
        .filter((c) => c.amount)
        .map((c, i) => ({
          exhibition_id: id!,
          item: c.item.trim() || "其他",
          amount: c.amount || 0,
          sort_order: i,
        }));
      if (costPayload.length > 0) {
        const { error } = await supabase.from("exhibition_costs").insert(costPayload);
        if (error) return void toast.error(`成本明細儲存失敗：${error.message}`);
      }
      const initialIds = new Set(linkedPurchases.map((p) => p.id));
      const currentIds = new Set(linked.map((p) => p.id));
      const added = [...currentIds].filter((pid) => !initialIds.has(pid));
      const removed = [...initialIds].filter((pid) => !currentIds.has(pid));
      if (added.length > 0) {
        const { error } = await supabase.from("purchases").update({ exhibition_id: id }).in("id", added);
        if (error) return void toast.error(`連結採購失敗：${error.message}`);
      }
      if (removed.length > 0) {
        const { error } = await supabase.from("purchases").update({ exhibition_id: null }).in("id", removed);
        if (error) return void toast.error(`解除採購連結失敗：${error.message}`);
      }
      toast.success("已儲存展覽場次");
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!existing) return;
    const { error } = await supabase.from("exhibitions").delete().eq("id", existing.id);
    if (error) return void toast.error(error.message);
    toast.success("已刪除展覽場次");
    onSaved();
  }

  return (
    <Dialog.Root open={target !== null} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-lg focus:outline-none">
          <div className="flex items-start justify-between gap-4">
            <Dialog.Title className="text-base font-semibold text-foreground">
              {existing ? `編輯 ${exhibitionLabel(existing)}` : "新增展覽場次"}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-accent/40 focus:outline-none focus:ring-2 focus:ring-ring"
                aria-label="關閉"
              >
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">填寫展覽場次的展期、對應客戶來源與參展成本</Dialog.Description>

          <form onSubmit={handleSubmit} className="mt-4 space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex min-w-0 flex-col gap-1.5">
                <label htmlFor="exhibition-name" className={labelClass}>展名 *</label>
                <input
                  id="exhibition-name"
                  list="exhibition-name-presets"
                  value={name}
                  onChange={(e) => {
                    const next = e.target.value;
                    setName(next);
                    if (!customerSource) setCustomerSource(defaultCustomerSourceFor(next) ?? "");
                  }}
                  className={inputClass}
                  placeholder="木質生活展"
                />
                <datalist id="exhibition-name-presets">
                  {EXHIBITION_NAME_PRESETS.map((n) => (
                    <option key={n} value={n} />
                  ))}
                </datalist>
              </div>
              <div className="flex min-w-0 flex-col gap-1.5">
                <label htmlFor="exhibition-location" className={labelClass}>地點</label>
                <input
                  id="exhibition-location"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  className={inputClass}
                  placeholder="台中國際展覽館"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex min-w-0 flex-col gap-1.5">
                <label htmlFor="exhibition-start" className={labelClass}>展期開始 *</label>
                <input
                  id="exhibition-start"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div className="flex min-w-0 flex-col gap-1.5">
                <label htmlFor="exhibition-end" className={labelClass}>展期結束 *</label>
                <input
                  id="exhibition-end"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className={inputClass}
                />
              </div>
            </div>
            <div className="flex min-w-0 flex-col gap-1.5">
              <label htmlFor="exhibition-source" className={labelClass}>對應客戶來源（統計哪些客人的訂單）</label>
              <select
                id="exhibition-source"
                value={customerSource}
                onChange={(e) => setCustomerSource(e.target.value)}
                className={inputClass}
              >
                <option value="">不對應（無法統計成交）</option>
                {EXHIBITION_CUSTOMER_SOURCES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>

            <div className="space-y-3 rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
                <span className="text-sm font-medium text-foreground">參展成本</span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  合計 {formatMoney(purchaseTotal + otherTotal)}（採購 {formatMoney(purchaseTotal)}＋其他{" "}
                  {formatMoney(otherTotal)}）
                </span>
              </div>

              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className={labelClass}>連結的採購（未稅）</span>
                  <Button type="button" variant="outline" onClick={() => void openPicker()}>
                    <Link2 className="h-4 w-4" />
                    從採購連結
                  </Button>
                </div>
                {linked.length === 0 ? (
                  <p className="text-xs text-muted-foreground">尚未連結採購。攤位費、裝潢等已在採購登記的支出，按「從採購連結」勾選帶入。</p>
                ) : (
                  <ul className="divide-y divide-border rounded-md border border-border">
                    {linked.map((p) => (
                      <li key={p.id} className="flex items-center gap-2 px-2 py-1.5">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm text-foreground">
                            {p.item_name}
                            {p.vendor_name ? <span className="text-muted-foreground"> · {p.vendor_name}</span> : null}
                          </div>
                          <div className="truncate text-xs text-muted-foreground">
                            {p.purchase_date.replace(/-/g, "/")}
                            {p.po_number ? ` · ${p.po_number}` : ""}
                          </div>
                          {p.po_notes ? (
                            <div className="truncate text-xs text-muted-foreground">備註：{p.po_notes}</div>
                          ) : null}
                        </div>
                        <span className="shrink-0 text-sm tabular-nums">{formatMoney(purchaseCostAmount(p))}</span>
                        <button
                          type="button"
                          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/40"
                          aria-label="解除連結"
                          title="解除連結（採購資料不受影響）"
                          onClick={() => setLinked((prev) => prev.filter((x) => x.id !== p.id))}
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                {pickerOpen ? (
                  <div className="space-y-2 rounded-md border border-dashed border-border bg-muted/30 p-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        aria-label="搜尋採購"
                        value={pickerSearch}
                        onChange={(e) => setPickerSearch(e.target.value)}
                        className={`${inputClass} min-w-0 flex-1`}
                        placeholder="搜尋品名、廠商、類別、單號、備註"
                      />
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      列出展前 180 天～展後 60 天、尚未連結其他展覽的採購；品名、廠商或備註含「展覽／攤位／佈置」的排在前面。勾選後按「連結所選」，儲存才會生效。
                    </p>
                    {pickerLoading ? (
                      <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        讀取中…
                      </div>
                    ) : visibleCandidates.length === 0 ? (
                      <p className="py-3 text-center text-xs text-muted-foreground">這段期間沒有可連結的採購</p>
                    ) : (
                      <ul className="max-h-64 divide-y divide-border overflow-y-auto rounded-md border border-border bg-background">
                        {visibleCandidates.map((p) => (
                          <li key={p.id}>
                            <label className="flex cursor-pointer items-center gap-2 px-2 py-1.5 hover:bg-muted/40">
                              <input
                                type="checkbox"
                                className="h-4 w-4 shrink-0"
                                checked={picked.has(p.id)}
                                onChange={(e) =>
                                  setPicked((prev) => {
                                    const next = new Set(prev);
                                    if (e.target.checked) next.add(p.id);
                                    else next.delete(p.id);
                                    return next;
                                  })
                                }
                              />
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-sm text-foreground">
                                  {p.item_name}
                                  {p.vendor_name ? <span className="text-muted-foreground"> · {p.vendor_name}</span> : null}
                                </div>
                                <div className="truncate text-xs text-muted-foreground">
                                  {p.purchase_date.replace(/-/g, "/")}
                                  {p.item_category ? ` · ${p.item_category}` : ""}
                                  {p.po_number ? ` · ${p.po_number}` : ""}
                                </div>
                                {p.po_notes ? (
                                  <div className="truncate text-xs text-muted-foreground">備註：{p.po_notes}</div>
                                ) : null}
                              </div>
                              <span className="shrink-0 text-sm tabular-nums">{formatMoney(purchaseCostAmount(p))}</span>
                            </label>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button type="button" variant="outline" onClick={() => setPickerOpen(false)}>
                        取消
                      </Button>
                      <Button type="button" disabled={picked.size === 0} onClick={linkPicked}>
                        連結所選（{picked.size}）
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="space-y-2">
                <span className={labelClass}>其他成本（沒有走採購的，例如人力加班、住宿餐費）</span>
                <datalist id="exhibition-cost-presets">
                  {EXHIBITION_COST_ITEM_PRESETS.map((n) => (
                    <option key={n} value={n} />
                  ))}
                </datalist>
                {costLines.map((c) => (
                  <div key={c.key} className="flex items-center gap-2">
                    <input
                      aria-label="成本項目"
                      list="exhibition-cost-presets"
                      value={c.item}
                      onChange={(e) =>
                        setCostLines((prev) => prev.map((x) => (x.key === c.key ? { ...x, item: e.target.value } : x)))
                      }
                      className={`${inputClass} min-w-0 flex-1`}
                      placeholder="項目"
                    />
                    <NumericInput
                      aria-label="金額"
                      value={c.amount}
                      onValueChange={(v) =>
                        setCostLines((prev) => prev.map((x) => (x.key === c.key ? { ...x, amount: v ?? 0 } : x)))
                      }
                      className="w-28 shrink-0 text-right"
                    />
                    <button
                      type="button"
                      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/40"
                      aria-label="刪除此項"
                      onClick={() => setCostLines((prev) => prev.filter((x) => x.key !== c.key))}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setCostLines((prev) => [...prev, { key: `new-${Date.now()}`, item: "", amount: 0 }])}
                >
                  <Plus className="h-4 w-4" />
                  新增其他成本
                </Button>
              </div>
            </div>

            <div className="flex min-w-0 flex-col gap-1.5">
              <label htmlFor="exhibition-notes" className={labelClass}>備註</label>
              <textarea
                id="exhibition-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="min-h-[60px] w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              {existing ? (
                <Button type="button" variant="outline" onClick={() => setConfirmDelete(true)}>
                  <Trash2 className="h-4 w-4" />
                  刪除場次
                </Button>
              ) : (
                <span />
              )}
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={onClose}>
                  取消
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  儲存
                </Button>
              </div>
            </div>
          </form>

          <ConfirmDialog
            open={confirmDelete}
            onOpenChange={setConfirmDelete}
            title="刪除展覽場次"
            description="成本明細會一併刪除，連結的採購會解除連結（訂單與採購資料不受影響）。確定刪除？"
            confirmLabel="刪除"
            destructive
            onConfirm={handleDelete}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
