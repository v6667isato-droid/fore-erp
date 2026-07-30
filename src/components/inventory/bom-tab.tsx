"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Plus, Trash2, Copy } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface SeriesOption {
  id: string;
  series_name: string;
}

interface VariantOption {
  id: string;
  series_id: string | null;
  product_code: string;
  wood_type: string | null;
  spec1: string | null;
}

interface PartOption {
  id: string;
  part_no: string;
  name: string;
  unit: string;
  wood_species: string | null;
}

interface BomItemWithPart {
  id: string;
  part_id: string;
  quantity: number;
  unit: string | null;
  notes: string | null;
  parts: { part_no: string; name: string; unit: string; wood_species: string | null } | null;
}

export interface BomTabProps {
  isAdmin?: boolean;
}

function variantLabel(v: VariantOption): string {
  const extra = [v.wood_type, v.spec1].filter(Boolean).join("・");
  return extra ? `${v.product_code}（${extra}）` : v.product_code;
}

/** 維護 variant ↔ 零件 的單層 BOM（bom_items） */
export function BomTab({ isAdmin = false }: BomTabProps) {
  const [series, setSeries] = useState<SeriesOption[]>([]);
  const [variants, setVariants] = useState<VariantOption[]>([]);
  const [parts, setParts] = useState<PartOption[]>([]);
  const [seriesId, setSeriesId] = useState("");
  const [variantId, setVariantId] = useState("");
  const [items, setItems] = useState<BomItemWithPart[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [newPartId, setNewPartId] = useState("");
  const [newQty, setNewQty] = useState("1");
  const [busy, setBusy] = useState(false);
  const [deleteItem, setDeleteItem] = useState<BomItemWithPart | null>(null);
  const [copySourceId, setCopySourceId] = useState("");
  const [copySeriesId, setCopySeriesId] = useState("");
  const [copySearch, setCopySearch] = useState("");
  const [copyConfirmOpen, setCopyConfirmOpen] = useState(false);
  /** 每列數量的編輯值（key=bom_item id）；儲存於 blur */
  const [qtyDrafts, setQtyDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [seriesRes, variantsRes, partsRes] = await Promise.all([
        supabase.from("product_series").select("id, series_name").is("deleted_at", null).order("series_name"),
        supabase
          .from("product_variants")
          .select("id, series_id, product_code, wood_type, spec1")
          .is("deleted_at", null)
          .order("product_code"),
        supabase.from("parts").select("id, part_no, name, unit, wood_species").is("deleted_at", null).order("part_no"),
      ]);
      if (cancelled) return;
      setSeries((seriesRes.data as SeriesOption[]) ?? []);
      setVariants((variantsRes.data as VariantOption[]) ?? []);
      setParts((partsRes.data as PartOption[]) ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const seriesVariants = useMemo(
    () => variants.filter((v) => v.series_id === seriesId),
    [variants, seriesId],
  );

  const fetchItems = useCallback(async (vid: string) => {
    if (!vid) {
      setItems([]);
      return;
    }
    setLoadingItems(true);
    const { data, error } = await supabase
      .from("bom_items")
      .select("id, part_id, quantity, unit, notes, parts!part_id(part_no, name, unit, wood_species)")
      .eq("variant_id", vid)
      .order("created_at");
    setLoadingItems(false);
    if (error) {
      toast.error(error.message || "無法載入 BOM");
      setItems([]);
      return;
    }
    setItems((data as unknown as BomItemWithPart[]) ?? []);
    setQtyDrafts({});
  }, []);

  useEffect(() => {
    void fetchItems(variantId);
  }, [variantId, fetchItems]);

  /** 複製來源候選：排除目前規格，依系列篩選與關鍵字（品號/材種/規格）過濾 */
  const copyCandidates = useMemo(() => {
    const q = copySearch.trim().toLowerCase();
    return variants.filter((v) => {
      if (v.id === variantId) return false;
      if (copySeriesId && v.series_id !== copySeriesId) return false;
      if (!q) return true;
      return (
        v.product_code.toLowerCase().includes(q) ||
        (v.wood_type || "").toLowerCase().includes(q) ||
        (v.spec1 || "").toLowerCase().includes(q)
      );
    });
  }, [variants, variantId, copySeriesId, copySearch]);

  // 篩選改變後，已選的來源若不在候選內就清掉
  useEffect(() => {
    if (copySourceId && !copyCandidates.some((v) => v.id === copySourceId)) {
      setCopySourceId("");
    }
  }, [copyCandidates, copySourceId]);

  const usedPartIds = useMemo(() => new Set(items.map((it) => it.part_id)), [items]);
  const addableParts = useMemo(() => parts.filter((p) => !usedPartIds.has(p.id)), [parts, usedPartIds]);

  async function addItem() {
    if (!variantId || !newPartId) return;
    const qty = Number(newQty);
    if (!Number.isFinite(qty) || qty <= 0) {
      toast.error("用量必須大於 0");
      return;
    }
    setBusy(true);
    const { error } = await supabase.from("bom_items").insert({
      variant_id: variantId,
      part_id: newPartId,
      quantity: qty,
    });
    setBusy(false);
    if (error) {
      toast.error(error.message || "加入失敗");
      return;
    }
    setNewPartId("");
    setNewQty("1");
    void fetchItems(variantId);
  }

  async function saveQty(item: BomItemWithPart) {
    const raw = qtyDrafts[item.id];
    if (raw == null) return;
    const qty = Number(raw);
    if (!Number.isFinite(qty) || qty <= 0) {
      toast.error("用量必須大於 0");
      setQtyDrafts((d) => ({ ...d, [item.id]: String(item.quantity) }));
      return;
    }
    if (qty === item.quantity) return;
    const { error } = await supabase.from("bom_items").update({ quantity: qty }).eq("id", item.id);
    if (error) {
      toast.error(error.message || "更新用量失敗");
      return;
    }
    void fetchItems(variantId);
  }

  async function performDelete() {
    if (!deleteItem) return;
    const id = deleteItem.id;
    setDeleteItem(null);
    const { error } = await supabase.from("bom_items").delete().eq("id", id);
    if (error) {
      toast.error(error.message || "刪除失敗");
      return;
    }
    void fetchItems(variantId);
  }

  async function performCopy() {
    setCopyConfirmOpen(false);
    if (!variantId || !copySourceId) return;
    setBusy(true);
    const { data: sourceRows, error } = await supabase
      .from("bom_items")
      .select("part_id, quantity, unit, notes")
      .eq("variant_id", copySourceId);
    if (error) {
      setBusy(false);
      toast.error(error.message || "無法讀取來源 BOM");
      return;
    }
    const toInsert = (sourceRows ?? [])
      .filter((r) => !usedPartIds.has(r.part_id))
      .map((r) => ({
        variant_id: variantId,
        part_id: r.part_id,
        quantity: r.quantity,
        unit: r.unit,
        notes: r.notes,
      }));
    if (toInsert.length === 0) {
      setBusy(false);
      toast.info("來源沒有可複製的零件（皆已存在或來源為空）");
      return;
    }
    const { error: insErr } = await supabase.from("bom_items").insert(toInsert);
    setBusy(false);
    if (insErr) {
      toast.error(insErr.message || "複製失敗");
      return;
    }
    toast.success(`已複製 ${toInsert.length} 項零件`);
    setCopySourceId("");
    void fetchItems(variantId);
  }

  const inputCls =
    "h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring";
  const copySourceVariant = variants.find((v) => v.id === copySourceId);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        每個產品規格（variant）維護自己的用料表；接單開整備工單時依此展開零件需求。
      </p>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:flex-wrap">
        <div className="flex min-w-[12rem] flex-col gap-1.5">
          <label htmlFor="bom-series" className="text-xs text-muted-foreground">產品系列</label>
          <select
            id="bom-series"
            value={seriesId}
            onChange={(e) => {
              setSeriesId(e.target.value);
              setVariantId("");
            }}
            className={inputCls}
          >
            <option value="">選擇系列…</option>
            {series.map((s) => (
              <option key={s.id} value={s.id}>{s.series_name}</option>
            ))}
          </select>
        </div>
        <div className="flex min-w-[16rem] flex-col gap-1.5">
          <label htmlFor="bom-variant" className="text-xs text-muted-foreground">產品規格</label>
          <select
            id="bom-variant"
            value={variantId}
            onChange={(e) => setVariantId(e.target.value)}
            className={inputCls}
            disabled={!seriesId}
          >
            <option value="">{seriesId ? "選擇規格…" : "請先選系列"}</option>
            {seriesVariants.map((v) => (
              <option key={v.id} value={v.id}>{variantLabel(v)}</option>
            ))}
          </select>
        </div>
        {isAdmin && variantId && (
          <div className="flex flex-col gap-1.5 sm:ml-auto">
            <label htmlFor="bom-copy-source" className="text-xs text-muted-foreground">從其他規格複製</label>
            <div className="flex flex-wrap gap-2">
              <select
                value={copySeriesId}
                onChange={(e) => setCopySeriesId(e.target.value)}
                className={cn(inputCls, "w-[10rem]")}
                aria-label="來源系列篩選"
              >
                <option value="">全部系列</option>
                {series.map((s) => (
                  <option key={s.id} value={s.id}>{s.series_name}</option>
                ))}
              </select>
              <input
                type="search"
                value={copySearch}
                onChange={(e) => setCopySearch(e.target.value)}
                placeholder="搜尋品號、材種…"
                className={cn(inputCls, "w-[10rem]")}
                aria-label="搜尋來源規格"
              />
              <select
                id="bom-copy-source"
                value={copySourceId}
                onChange={(e) => setCopySourceId(e.target.value)}
                className={cn(inputCls, "min-w-[12rem]")}
              >
                <option value="">
                  {copyCandidates.length === 0 ? "無符合的規格" : `選擇來源規格…（${copyCandidates.length}）`}
                </option>
                {copyCandidates.map((v) => (
                  <option key={v.id} value={v.id}>{variantLabel(v)}</option>
                ))}
              </select>
              <Button
                type="button"
                variant="outline"
                className="h-9 shrink-0"
                disabled={!copySourceId || busy}
                onClick={() => setCopyConfirmOpen(true)}
              >
                <Copy className="h-4 w-4 mr-1" />
                複製
              </Button>
            </div>
          </div>
        )}
      </div>

      {variantId ? (
        <>
          <div className="rounded-xl border border-border bg-card overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-b border-border">
                  <TableHead className="text-xs font-semibold p-2">料號</TableHead>
                  <TableHead className="text-xs font-semibold p-2">零件名稱</TableHead>
                  <TableHead className="hidden text-xs font-semibold p-2 sm:table-cell">材種</TableHead>
                  <TableHead className="text-xs font-semibold p-2 text-right w-[120px]">用量</TableHead>
                  <TableHead className="text-xs font-semibold p-2 w-[64px]">單位</TableHead>
                  {isAdmin && <TableHead className="text-xs font-semibold p-2 w-[56px]" aria-label="操作">操作</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingItems ? (
                  <TableRow>
                    <TableCell colSpan={isAdmin ? 6 : 5} className="h-24 text-center text-muted-foreground text-sm" role="status">
                      載入 BOM 中…
                    </TableCell>
                  </TableRow>
                ) : items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={isAdmin ? 6 : 5} className="h-24 text-center text-muted-foreground text-sm">
                      此規格尚未建立用料，請在下方加入零件
                    </TableCell>
                  </TableRow>
                ) : (
                  items.map((it) => (
                    <TableRow key={it.id} className="border-b border-border hover:bg-muted/30">
                      <TableCell className="text-sm p-2 font-medium whitespace-nowrap">{it.parts?.part_no ?? "—"}</TableCell>
                      <TableCell className="text-sm p-2">
                        {it.parts?.name ?? "（零件已刪除）"}
                        {it.parts?.wood_species ? (
                          <span className="mt-0.5 block text-xs text-muted-foreground sm:hidden">
                            {it.parts.wood_species}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="hidden whitespace-nowrap text-sm p-2 text-muted-foreground sm:table-cell">
                        {it.parts?.wood_species ?? "—"}
                      </TableCell>
                      <TableCell className="text-sm p-2 text-right">
                        {isAdmin ? (
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={qtyDrafts[it.id] ?? String(it.quantity)}
                            onChange={(e) => setQtyDrafts((d) => ({ ...d, [it.id]: e.target.value }))}
                            onBlur={() => void saveQty(it)}
                            className="h-8 w-24 rounded-lg border border-input bg-background px-2 text-right text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                            aria-label={`${it.parts?.name ?? ""} 用量`}
                          />
                        ) : (
                          <span className="tabular-nums">{it.quantity}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm p-2 text-muted-foreground">{it.unit || it.parts?.unit || "—"}</TableCell>
                      {isAdmin && (
                        <TableCell className="p-2">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={() => setDeleteItem(it)}
                            aria-label={`移除 ${it.parts?.name ?? "零件"}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {isAdmin && (
            <div className="flex flex-wrap items-end gap-2 rounded-xl border border-border bg-card p-3">
              <div className="flex min-w-[16rem] flex-1 flex-col gap-1.5">
                <label htmlFor="bom-new-part" className="text-xs text-muted-foreground">加入零件</label>
                <select id="bom-new-part" value={newPartId} onChange={(e) => setNewPartId(e.target.value)} className={inputCls}>
                  <option value="">選擇零件…</option>
                  {addableParts.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.part_no}｜{p.name}
                      {p.wood_species ? `・${p.wood_species}` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="bom-new-qty" className="text-xs text-muted-foreground">用量</label>
                <input
                  id="bom-new-qty"
                  type="number"
                  min="0"
                  step="any"
                  value={newQty}
                  onChange={(e) => setNewQty(e.target.value)}
                  className={cn(inputCls, "w-24 text-right")}
                />
              </div>
              <Button type="button" className="h-9" disabled={!newPartId || busy} onClick={() => void addItem()}>
                <Plus className="h-4 w-4 mr-1" />
                加入
              </Button>
            </div>
          )}
        </>
      ) : (
        <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          選擇系列與規格後顯示其用料表
        </div>
      )}

      <ConfirmDialog
        open={copyConfirmOpen}
        onOpenChange={setCopyConfirmOpen}
        title="是否複製此規格的用料表？"
        description={
          copySourceVariant ? (
            <>
              <p className="font-medium text-foreground">{variantLabel(copySourceVariant)}</p>
              <p className="mt-2 text-muted-foreground text-sm">
                來源的零件會加入目前規格的用料表；已存在的零件會略過、不覆蓋用量。複製後可再逐列調整（例如改成對應材種的木料）。
              </p>
            </>
          ) : null
        }
        confirmLabel="確定複製"
        onConfirm={performCopy}
      />

      <ConfirmDialog
        open={deleteItem != null}
        onOpenChange={(open) => !open && setDeleteItem(null)}
        title="是否自用料表移除此零件？"
        description={
          deleteItem ? (
            <p className="font-medium text-foreground">
              {deleteItem.parts ? `${deleteItem.parts.part_no}｜${deleteItem.parts.name}` : "（零件已刪除）"}
            </p>
          ) : null
        }
        confirmLabel="確定移除"
        onConfirm={performDelete}
        destructive
      />
    </div>
  );
}
