"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  PART_CATEGORIES,
  type MaterialRow,
  type PartOptionGroupRow,
  type PartOptionValueRow,
} from "@/types/inventory";
import { fetchMaterials } from "@/lib/part-variants";

export interface PartOptionsTabProps {
  isAdmin?: boolean;
}

const inputCls =
  "h-9 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring";

/** 產品端木種選項（option_types.code = 'wood' 底下的 option_values） */
interface ProductWood {
  id: string;
  code: string;
  name_zh: string;
  sort_order: number;
}

function isDuplicateError(message: string | undefined): boolean {
  return /duplicate|23505|unique/i.test(String(message ?? ""));
}

function nextSort(list: { sort_order: number }[]): number {
  return (list.length > 0 ? Math.max(...list.map((x) => x.sort_order)) : 0) + 10;
}

interface MaterialDraft {
  code: string;
  name: string;
  /** 對應到哪些產品木種（存進 materials.aliases；與自身名稱相同者不重複存） */
  woodNames: Set<string>;
  sort: string;
}

const EMPTY_MATERIAL_DRAFT: MaterialDraft = { code: "", name: "", woodNames: new Set(), sort: "" };

interface GroupDraft {
  code: string;
  name: string;
  sort: string;
}

const EMPTY_GROUP_DRAFT: GroupDraft = { code: "", name: "", sort: "" };

/** 代碼＋名稱＋排序的共用三欄輸入（新增與編輯共用）；定義於元件外避免每次 render 重掛而失焦 */
function CodeNameSortFields({
  idPrefix,
  draft,
  onChange,
  codeDisabled = false,
  codePlaceholder,
  namePlaceholder,
}: {
  idPrefix: string;
  draft: GroupDraft;
  onChange: (patch: Partial<GroupDraft>) => void;
  codeDisabled?: boolean;
  codePlaceholder?: string;
  namePlaceholder?: string;
}) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      <div className="flex flex-col gap-1">
        <label htmlFor={`${idPrefix}-code`} className="text-[11px] text-muted-foreground">代碼 *</label>
        <input
          id={`${idPrefix}-code`}
          type="text"
          value={draft.code}
          onChange={(e) => onChange({ code: e.target.value })}
          disabled={codeDisabled}
          className={cn(inputCls, "disabled:cursor-not-allowed disabled:opacity-60")}
          placeholder={codePlaceholder}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${idPrefix}-name`} className="text-[11px] text-muted-foreground">名稱 *</label>
        <input
          id={`${idPrefix}-name`}
          type="text"
          value={draft.name}
          onChange={(e) => onChange({ name: e.target.value })}
          className={inputCls}
          placeholder={namePlaceholder}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${idPrefix}-sort`} className="text-[11px] text-muted-foreground">排序</label>
        <input
          id={`${idPrefix}-sort`}
          type="number"
          value={draft.sort}
          onChange={(e) => onChange({ sort: e.target.value })}
          className={inputCls}
          placeholder="自動"
        />
      </div>
    </div>
  );
}

/** 產品木種對應勾選；與零件木種同名者自動對應、不可取消 */
function ProductWoodPicker({
  idPrefix,
  productWoods,
  draft,
  onToggle,
  ownerOf,
}: {
  idPrefix: string;
  productWoods: ProductWood[];
  draft: MaterialDraft;
  onToggle: (name: string, checked: boolean) => void;
  /** 產品木種名稱 → 目前對應到的「其他」零件木種名稱；沒有則 null */
  ownerOf: (name: string) => string | null;
}) {
  const selfName = draft.name.trim();
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="text-[11px] text-muted-foreground">對應的產品木種</legend>
      {productWoods.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">尚未建立產品木種選項。</p>
      ) : (
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {productWoods.map((w) => {
            const isSelf = w.name_zh === selfName;
            const owner = ownerOf(w.name_zh);
            return (
              <label key={w.id} className="flex items-center gap-1.5 text-sm text-foreground">
                <input
                  id={`${idPrefix}-wood-${w.id}`}
                  type="checkbox"
                  checked={isSelf || draft.woodNames.has(w.name_zh)}
                  disabled={isSelf}
                  onChange={(e) => onToggle(w.name_zh, e.target.checked)}
                  className="h-4 w-4 rounded border-input accent-[var(--primary)] disabled:opacity-60"
                />
                {w.name_zh}
                <span className="text-xs text-muted-foreground">
                  ({w.code})
                  {isSelf ? "・同名自動對應" : owner ? `・目前對應 ${owner}` : ""}
                </span>
              </label>
            );
          })}
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">
        勾選＝訂單用到這個產品木種時，扣的是此零件木種的庫存。一個產品木種只會對應一個零件木種，改勾會自動從原本那個移除。
      </p>
    </fieldset>
  );
}

type DeleteTarget =
  | { kind: "material"; id: string; label: string }
  | { kind: "group"; id: string; label: string }
  | { kind: "value"; id: string; label: string };

/**
 * 零件變體選項設定：以四大分類分頁管理各分類的選項「大項」與「細項」。
 * 木料的「木材種類」沿用 materials 主檔（會實際生成零件變體、影響 SKU 與 BOM）；
 * 其餘自訂大項目前僅為主檔，尚未參與變體生成。
 */
export function PartOptionsTab({ isAdmin = false }: PartOptionsTabProps) {
  const [category, setCategory] = useState<string>(PART_CATEGORIES[0]);
  const [loading, setLoading] = useState(true);
  const [materials, setMaterials] = useState<MaterialRow[]>([]);
  /** material code → 使用中的零件變體數（>0 不可刪除、不可改代碼） */
  const [materialUsage, setMaterialUsage] = useState<Map<string, number>>(new Map());
  const [groups, setGroups] = useState<PartOptionGroupRow[]>([]);
  const [values, setValues] = useState<PartOptionValueRow[]>([]);
  const [productWoods, setProductWoods] = useState<ProductWood[]>([]);
  const [busy, setBusy] = useState(false);

  const [editingMaterial, setEditingMaterial] = useState<string | null>(null);
  const [materialDraft, setMaterialDraft] = useState<MaterialDraft>(EMPTY_MATERIAL_DRAFT);
  const [addMaterialOpen, setAddMaterialOpen] = useState(false);
  const [addMaterialDraft, setAddMaterialDraft] = useState<MaterialDraft>(EMPTY_MATERIAL_DRAFT);

  const [editingGroup, setEditingGroup] = useState<string | null>(null);
  const [groupDraft, setGroupDraft] = useState<GroupDraft>(EMPTY_GROUP_DRAFT);
  const [addGroupOpen, setAddGroupOpen] = useState(false);
  const [addGroupDraft, setAddGroupDraft] = useState<GroupDraft>(EMPTY_GROUP_DRAFT);

  const [editingValue, setEditingValue] = useState<string | null>(null);
  const [valueDraft, setValueDraft] = useState<GroupDraft>(EMPTY_GROUP_DRAFT);
  const [addValueFor, setAddValueFor] = useState<string | null>(null);
  const [addValueDraft, setAddValueDraft] = useState<GroupDraft>(EMPTY_GROUP_DRAFT);

  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [materialsRes, variantsRes, groupsRes, valuesRes, optionTypesRes, optionValuesRes] =
      await Promise.all([
        fetchMaterials().catch(() => [] as MaterialRow[]),
        supabase.from("part_variants").select("material_code").is("deleted_at", null),
        supabase
          .from("part_option_groups")
          .select("id, category, code, name_zh, sort_order, notes")
          .is("deleted_at", null)
          .order("sort_order"),
        supabase
          .from("part_option_values")
          .select("id, group_id, code, name_zh, sort_order")
          .is("deleted_at", null)
          .order("sort_order"),
        supabase.from("option_types").select("id, code"),
        supabase.from("option_values").select("id, option_type_id, code, name_zh, sort_order").order("sort_order"),
      ]);
    setLoading(false);
    if (groupsRes.error || valuesRes.error) {
      toast.error(groupsRes.error?.message || valuesRes.error?.message || "無法載入選項設定");
    }
    setMaterials(materialsRes);
    const usage = new Map<string, number>();
    for (const v of variantsRes.data ?? []) {
      const code = (v as { material_code: string | null }).material_code;
      if (code) usage.set(code, (usage.get(code) ?? 0) + 1);
    }
    setMaterialUsage(usage);
    setGroups((groupsRes.data as PartOptionGroupRow[]) ?? []);
    setValues((valuesRes.data as PartOptionValueRow[]) ?? []);
    const woodTypeId =
      ((optionTypesRes.data ?? []) as { id: string; code: string }[]).find((t) => t.code === "wood")?.id ?? null;
    setProductWoods(
      woodTypeId
        ? (((optionValuesRes.data ?? []) as (ProductWood & { option_type_id: string })[])
            .filter((v) => v.option_type_id === woodTypeId)
            .map(({ id, code, name_zh, sort_order }) => ({ id, code, name_zh, sort_order })))
        : [],
    );
  }, []);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  const categoryGroups = useMemo(
    () => groups.filter((g) => g.category === category),
    [groups, category],
  );

  const valuesByGroup = useMemo(() => {
    const m = new Map<string, PartOptionValueRow[]>();
    for (const v of values) {
      const list = m.get(v.group_id);
      if (list) list.push(v);
      else m.set(v.group_id, [v]);
    }
    return m;
  }, [values]);

  // ── 木材種類（materials） ────────────────────────────────────────────

  /** 產品木種名稱 → 對應到的零件木種（名稱相同或列在 aliases） */
  const materialByWoodName = useMemo(() => {
    const m = new Map<string, MaterialRow>();
    for (const mat of materials) {
      m.set(mat.name_zh, mat);
      for (const a of mat.aliases ?? []) if (!m.has(a)) m.set(a, mat);
    }
    return m;
  }, [materials]);

  /** 還沒被任何零件木種對應到的產品木種（下單時無法 resolve 出零件變體） */
  const unmappedWoods = useMemo(
    () => productWoods.filter((w) => !materialByWoodName.has(w.name_zh)),
    [productWoods, materialByWoodName],
  );

  /** 該產品木種目前歸屬的其他零件木種名稱（供勾選時提示會被搬走） */
  function woodOwnerExcept(woodName: string, exceptCode: string | null): string | null {
    const owner = materialByWoodName.get(woodName);
    if (!owner || owner.code === exceptCode) return null;
    return owner.name_zh;
  }

  /** 勾走別的零件木種名下的產品木種時，從對方 aliases 移除，維持一對一 */
  async function releaseWoodNamesFromOthers(claimed: string[], keepCode: string) {
    for (const mat of materials) {
      if (mat.code === keepCode) continue;
      const kept = (mat.aliases ?? []).filter((a) => !claimed.includes(a));
      if (kept.length === (mat.aliases ?? []).length) continue;
      const { error } = await supabase.from("materials").update({ aliases: kept }).eq("code", mat.code);
      if (error) toast.error(`從「${mat.name_zh}」移除重複對應失敗：${error.message}`);
    }
    const blocked = claimed.filter((n) => materials.some((m) => m.code !== keepCode && m.name_zh === n));
    if (blocked.length > 0) {
      toast.warning(`「${blocked.join("、")}」同時是另一個零件木種的名稱，對應仍以該木種為準`);
    }
  }

  function startEditMaterial(m: MaterialRow) {
    setEditingMaterial(m.code);
    setMaterialDraft({
      code: m.code,
      name: m.name_zh,
      woodNames: new Set(m.aliases ?? []),
      sort: String(m.sort_order),
    });
  }

  function toggleDraftWood(
    setDraft: React.Dispatch<React.SetStateAction<MaterialDraft>>,
    woodName: string,
    checked: boolean,
  ) {
    setDraft((d) => {
      const next = new Set(d.woodNames);
      if (checked) next.add(woodName);
      else next.delete(woodName);
      return { ...d, woodNames: next };
    });
  }

  async function saveMaterial(original: MaterialRow) {
    if (busy) return;
    const code = materialDraft.code.trim().toUpperCase();
    const name = materialDraft.name.trim();
    if (!code || !name) {
      toast.error("請輸入代碼與名稱");
      return;
    }
    const inUse = (materialUsage.get(original.code) ?? 0) > 0;
    if (inUse && code !== original.code) {
      toast.error("此木種已有零件變體使用，代碼不可修改");
      return;
    }
    const sortRaw = materialDraft.sort.trim();
    const sort = sortRaw === "" ? original.sort_order : Number(sortRaw);
    if (!Number.isInteger(sort)) {
      toast.error("排序必須是整數");
      return;
    }
    const aliases = [...materialDraft.woodNames].filter((n) => n !== name);
    setBusy(true);
    const { error } = await supabase
      .from("materials")
      .update({ code, name_zh: name, aliases, sort_order: sort })
      .eq("code", original.code);
    if (error) {
      setBusy(false);
      toast.error(
        isDuplicateError(error.message) ? `已有代碼「${code}」的木種` : error.message || "儲存失敗",
      );
      return;
    }
    await releaseWoodNamesFromOthers(aliases, code);
    setBusy(false);
    setEditingMaterial(null);
    toast.success(`已更新「${name}」`);
    void fetchAll();
  }

  async function submitAddMaterial() {
    if (busy) return;
    const code = addMaterialDraft.code.trim().toUpperCase();
    const name = addMaterialDraft.name.trim();
    if (!code || !name) {
      toast.error("請輸入代碼與名稱");
      return;
    }
    const sortRaw = addMaterialDraft.sort.trim();
    const sort = sortRaw === "" ? nextSort(materials) : Number(sortRaw);
    if (!Number.isInteger(sort)) {
      toast.error("排序必須是整數");
      return;
    }
    const aliases = [...addMaterialDraft.woodNames].filter((n) => n !== name);
    setBusy(true);
    const { error } = await supabase.from("materials").insert({
      code,
      name_zh: name,
      aliases,
      sort_order: sort,
    });
    if (!error) await releaseWoodNamesFromOthers(aliases, code);
    setBusy(false);
    if (error) {
      toast.error(
        isDuplicateError(error.message) ? `已有代碼「${code}」的木種` : error.message || "新增失敗",
      );
      return;
    }
    setAddMaterialDraft(EMPTY_MATERIAL_DRAFT);
    setAddMaterialOpen(false);
    toast.success(`已新增木種「${name}」`);
    void fetchAll();
  }

  async function deleteMaterial(code: string) {
    if ((materialUsage.get(code) ?? 0) > 0) {
      toast.error("此木種已有零件變體使用，無法刪除");
      return;
    }
    const { error } = await supabase.from("materials").delete().eq("code", code);
    if (error) {
      toast.error(error.message || "刪除失敗");
      return;
    }
    toast.success("已刪除木種");
    void fetchAll();
  }

  // ── 自訂大項／細項 ──────────────────────────────────────────────────
  async function submitAddGroup() {
    if (busy) return;
    const code = addGroupDraft.code.trim();
    const name = addGroupDraft.name.trim();
    if (!code || !name) {
      toast.error("請輸入代碼與名稱");
      return;
    }
    const sortRaw = addGroupDraft.sort.trim();
    const sort = sortRaw === "" ? nextSort(categoryGroups) : Number(sortRaw);
    if (!Number.isInteger(sort)) {
      toast.error("排序必須是整數");
      return;
    }
    setBusy(true);
    const { error } = await supabase
      .from("part_option_groups")
      .insert({ category, code, name_zh: name, sort_order: sort });
    setBusy(false);
    if (error) {
      toast.error(
        isDuplicateError(error.message)
          ? `「${category}」已有代碼「${code}」的大項`
          : error.message || "新增大項失敗",
      );
      return;
    }
    setAddGroupDraft(EMPTY_GROUP_DRAFT);
    setAddGroupOpen(false);
    toast.success(`已新增大項「${name}」`);
    void fetchAll();
  }

  async function saveGroup(g: PartOptionGroupRow) {
    if (busy) return;
    const code = groupDraft.code.trim();
    const name = groupDraft.name.trim();
    if (!code || !name) {
      toast.error("請輸入代碼與名稱");
      return;
    }
    const sortRaw = groupDraft.sort.trim();
    const sort = sortRaw === "" ? g.sort_order : Number(sortRaw);
    if (!Number.isInteger(sort)) {
      toast.error("排序必須是整數");
      return;
    }
    setBusy(true);
    const { error } = await supabase
      .from("part_option_groups")
      .update({ code, name_zh: name, sort_order: sort })
      .eq("id", g.id);
    setBusy(false);
    if (error) {
      toast.error(
        isDuplicateError(error.message)
          ? `「${category}」已有代碼「${code}」的大項`
          : error.message || "儲存失敗",
      );
      return;
    }
    setEditingGroup(null);
    toast.success(`已更新大項「${name}」`);
    void fetchAll();
  }

  async function deleteGroup(id: string) {
    const now = new Date().toISOString();
    const { error } = await supabase
      .from("part_option_groups")
      .update({ deleted_at: now })
      .eq("id", id);
    if (error) {
      toast.error(error.message || "刪除大項失敗");
      return;
    }
    const { error: valErr } = await supabase
      .from("part_option_values")
      .update({ deleted_at: now })
      .eq("group_id", id)
      .is("deleted_at", null);
    if (valErr) toast.error(`大項已刪除，但底下細項未一併移除：${valErr.message}`);
    else toast.success("已刪除大項（含其細項）");
    void fetchAll();
  }

  async function submitAddValue(g: PartOptionGroupRow) {
    if (busy) return;
    const code = addValueDraft.code.trim();
    const name = addValueDraft.name.trim();
    if (!code || !name) {
      toast.error("請輸入代碼與名稱");
      return;
    }
    const sortRaw = addValueDraft.sort.trim();
    const sort = sortRaw === "" ? nextSort(valuesByGroup.get(g.id) ?? []) : Number(sortRaw);
    if (!Number.isInteger(sort)) {
      toast.error("排序必須是整數");
      return;
    }
    setBusy(true);
    const { error } = await supabase
      .from("part_option_values")
      .insert({ group_id: g.id, code, name_zh: name, sort_order: sort });
    setBusy(false);
    if (error) {
      toast.error(
        isDuplicateError(error.message)
          ? `「${g.name_zh}」已有代碼「${code}」的細項`
          : error.message || "新增細項失敗",
      );
      return;
    }
    setAddValueDraft(EMPTY_GROUP_DRAFT);
    setAddValueFor(null);
    toast.success(`已新增細項「${name}」`);
    void fetchAll();
  }

  async function saveValue(v: PartOptionValueRow) {
    if (busy) return;
    const code = valueDraft.code.trim();
    const name = valueDraft.name.trim();
    if (!code || !name) {
      toast.error("請輸入代碼與名稱");
      return;
    }
    const sortRaw = valueDraft.sort.trim();
    const sort = sortRaw === "" ? v.sort_order : Number(sortRaw);
    if (!Number.isInteger(sort)) {
      toast.error("排序必須是整數");
      return;
    }
    setBusy(true);
    const { error } = await supabase
      .from("part_option_values")
      .update({ code, name_zh: name, sort_order: sort })
      .eq("id", v.id);
    setBusy(false);
    if (error) {
      toast.error(
        isDuplicateError(error.message) ? `此大項已有代碼「${code}」的細項` : error.message || "儲存失敗",
      );
      return;
    }
    setEditingValue(null);
    toast.success(`已更新細項「${name}」`);
    void fetchAll();
  }

  async function deleteValue(id: string) {
    const { error } = await supabase
      .from("part_option_values")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id);
    if (error) {
      toast.error(error.message || "刪除細項失敗");
      return;
    }
    toast.success("已刪除細項");
    void fetchAll();
  }

  async function performDelete() {
    const target = deleteTarget;
    setDeleteTarget(null);
    if (!target) return;
    if (target.kind === "material") await deleteMaterial(target.id);
    else if (target.kind === "group") await deleteGroup(target.id);
    else await deleteValue(target.id);
  }

  if (loading && materials.length === 0 && groups.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground" role="status">
        載入選項設定中…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        管理各分類的變體選項。木料的「木材種類」會實際生成零件變體、決定 SKU 中段；其餘自訂大項目前僅建檔保存，尚未參與變體生成。
      </p>

      <div
        className="inline-flex flex-wrap rounded-xl border border-border bg-muted/30 p-1"
        role="tablist"
        aria-label="零件分類"
      >
        {PART_CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            role="tab"
            aria-selected={category === c}
            className={cn(
              "rounded-lg px-4 py-2 text-sm font-medium transition-colors",
              category === c ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => {
              setCategory(c);
              setEditingGroup(null);
              setEditingValue(null);
              setAddGroupOpen(false);
              setAddValueFor(null);
            }}
          >
            {c}
          </button>
        ))}
      </div>

      {category === "木料" && (
        <section className="rounded-xl border border-border bg-card">
          <div className="border-b border-border bg-muted/20 px-4 py-2.5">
            <h3 className="text-sm font-semibold text-foreground">
              木材種類
              <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground align-middle">
                系統內建
              </span>
            </h3>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              新增零件勾選「木料」時會列出這份清單；代碼會出現在 SKU 中段（例：CH03-<b>O</b>-REAR）。
              一個零件木種可以對應多個產品木種（同一塊料做出來的），下單時才知道要扣哪個變體的庫存。
            </p>
          </div>
          {unmappedWoods.length > 0 && (
            <p className="border-b border-border bg-amber-500/10 px-4 py-2 text-[11px] text-amber-700 dark:text-amber-400" role="status">
              產品木種「{unmappedWoods.map((w) => w.name_zh).join("、")}」還沒對應到任何零件木種，
              這些木種的訂單會找不到零件變體、無法自動扣料。
            </p>
          )}
          {materials.length === 0 ? (
            <p className="px-4 py-3 text-xs text-muted-foreground">尚無木種。</p>
          ) : (
            <ul className="divide-y divide-border">
              {materials.map((m) => {
                const used = materialUsage.get(m.code) ?? 0;
                if (editingMaterial === m.code) {
                  return (
                    <li key={m.code} className="space-y-2 px-4 py-3">
                      <CodeNameSortFields
                        idPrefix={`mat-edit-${m.code}`}
                        draft={{ code: materialDraft.code, name: materialDraft.name, sort: materialDraft.sort }}
                        onChange={(patch) => setMaterialDraft((d) => ({ ...d, ...patch }))}
                        codeDisabled={used > 0}
                        codePlaceholder="例：O"
                        namePlaceholder="例：白橡木"
                      />
                      <ProductWoodPicker
                        idPrefix={`mat-edit-${m.code}`}
                        productWoods={productWoods}
                        draft={materialDraft}
                        onToggle={(wood, checked) => toggleDraftWood(setMaterialDraft, wood, checked)}
                        ownerOf={(wood) => woodOwnerExcept(wood, m.code)}
                      />
                      {used > 0 && (
                        <p className="text-[11px] text-muted-foreground">
                          已有 {used} 個零件變體使用此木種，代碼不可修改。
                        </p>
                      )}
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" className="h-8 px-3 text-xs" onClick={() => void saveMaterial(m)} disabled={busy}>
                          儲存
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          className="h-8 px-3 text-xs"
                          onClick={() => setEditingMaterial(null)}
                          disabled={busy}
                        >
                          取消
                        </Button>
                      </div>
                    </li>
                  );
                }
                return (
                  <li key={m.code} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-foreground">
                        {m.name_zh}
                        <span className="ml-1.5 font-mono text-xs text-muted-foreground">({m.code})</span>
                        {used > 0 && (
                          <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground align-middle">
                            使用中 {used}
                          </span>
                        )}
                      </p>
                      {(() => {
                        const mapped = productWoods
                          .filter((w) => w.name_zh === m.name_zh || (m.aliases ?? []).includes(w.name_zh))
                          .map((w) => w.name_zh);
                        return (
                          <p className="mt-0.5 text-[11px] text-muted-foreground">
                            {mapped.length > 0 ? `對應產品木種：${mapped.join("、")}` : "尚未對應任何產品木種"}
                          </p>
                        );
                      })()}
                    </div>
                    {isAdmin && (
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => startEditMaterial(m)}
                          aria-label={`編輯 ${m.name_zh}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive disabled:opacity-40"
                          onClick={() => setDeleteTarget({ kind: "material", id: m.code, label: m.name_zh })}
                          disabled={used > 0}
                          aria-label={`刪除 ${m.name_zh}`}
                          title={used > 0 ? "已有零件變體使用，無法刪除" : undefined}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {isAdmin && (
            <div className="border-t border-border px-4 py-2.5">
              {addMaterialOpen ? (
                <div className="space-y-2">
                  <CodeNameSortFields
                    idPrefix="mat-add"
                    draft={{ code: addMaterialDraft.code, name: addMaterialDraft.name, sort: addMaterialDraft.sort }}
                    onChange={(patch) => setAddMaterialDraft((d) => ({ ...d, ...patch }))}
                    codePlaceholder="例：T"
                    namePlaceholder="例：柚木"
                  />
                  <ProductWoodPicker
                    idPrefix="mat-add"
                    productWoods={productWoods}
                    draft={addMaterialDraft}
                    onToggle={(wood, checked) => toggleDraftWood(setAddMaterialDraft, wood, checked)}
                    ownerOf={(wood) => woodOwnerExcept(wood, null)}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" className="h-8 px-3 text-xs" onClick={() => void submitAddMaterial()} disabled={busy}>
                      新增木種
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-8 px-3 text-xs"
                      onClick={() => {
                        setAddMaterialOpen(false);
                        setAddMaterialDraft(EMPTY_MATERIAL_DRAFT);
                      }}
                      disabled={busy}
                    >
                      取消
                    </Button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setAddMaterialOpen(true)}
                  className="inline-flex items-center gap-1 rounded text-xs text-primary hover:underline focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <Plus className="h-3.5 w-3.5" />
                  新增木種
                </button>
              )}
            </div>
          )}
        </section>
      )}

      {categoryGroups.map((g) => {
        const groupValues = valuesByGroup.get(g.id) ?? [];
        return (
          <section key={g.id} className="rounded-xl border border-border bg-card">
            <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border bg-muted/20 px-4 py-2.5">
              {editingGroup === g.id ? (
                <div className="w-full space-y-2">
                  <CodeNameSortFields
                    idPrefix={`grp-edit-${g.id}`}
                    draft={groupDraft}
                    onChange={(patch) => setGroupDraft((d) => ({ ...d, ...patch }))}
                    codePlaceholder="例：finish"
                    namePlaceholder="例：表面處理"
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" className="h-8 px-3 text-xs" onClick={() => void saveGroup(g)} disabled={busy}>
                      儲存
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-8 px-3 text-xs"
                      onClick={() => setEditingGroup(null)}
                      disabled={busy}
                    >
                      取消
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <h3 className="min-w-0 text-sm font-semibold text-foreground">
                    {g.name_zh}
                    <span className="ml-1.5 font-mono text-xs font-normal text-muted-foreground">({g.code})</span>
                  </h3>
                  {isAdmin && (
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => {
                          setEditingGroup(g.id);
                          setGroupDraft({ code: g.code, name: g.name_zh, sort: String(g.sort_order) });
                        }}
                        aria-label={`編輯大項 ${g.name_zh}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => setDeleteTarget({ kind: "group", id: g.id, label: g.name_zh })}
                        aria-label={`刪除大項 ${g.name_zh}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </>
              )}
            </div>

            {groupValues.length === 0 ? (
              <p className="px-4 py-3 text-xs text-muted-foreground">尚無細項。</p>
            ) : (
              <ul className="divide-y divide-border">
                {groupValues.map((v) =>
                  editingValue === v.id ? (
                    <li key={v.id} className="space-y-2 px-4 py-3">
                      <CodeNameSortFields
                        idPrefix={`val-edit-${v.id}`}
                        draft={valueDraft}
                        onChange={(patch) => setValueDraft((d) => ({ ...d, ...patch }))}
                      />
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" className="h-8 px-3 text-xs" onClick={() => void saveValue(v)} disabled={busy}>
                          儲存
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          className="h-8 px-3 text-xs"
                          onClick={() => setEditingValue(null)}
                          disabled={busy}
                        >
                          取消
                        </Button>
                      </div>
                    </li>
                  ) : (
                    <li key={v.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                      <p className="min-w-0 flex-1 text-sm text-foreground">
                        {v.name_zh}
                        <span className="ml-1.5 font-mono text-xs text-muted-foreground">({v.code})</span>
                      </p>
                      {isAdmin && (
                        <div className="flex shrink-0 items-center gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => {
                              setEditingValue(v.id);
                              setValueDraft({ code: v.code, name: v.name_zh, sort: String(v.sort_order) });
                            }}
                            aria-label={`編輯細項 ${v.name_zh}`}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={() => setDeleteTarget({ kind: "value", id: v.id, label: v.name_zh })}
                            aria-label={`刪除細項 ${v.name_zh}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      )}
                    </li>
                  ),
                )}
              </ul>
            )}

            {isAdmin && (
              <div className="border-t border-border px-4 py-2.5">
                {addValueFor === g.id ? (
                  <div className="space-y-2">
                    <CodeNameSortFields
                      idPrefix={`val-add-${g.id}`}
                      draft={addValueDraft}
                      onChange={(patch) => setAddValueDraft((d) => ({ ...d, ...patch }))}
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" className="h-8 px-3 text-xs" onClick={() => void submitAddValue(g)} disabled={busy}>
                        新增細項
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-8 px-3 text-xs"
                        onClick={() => {
                          setAddValueFor(null);
                          setAddValueDraft(EMPTY_GROUP_DRAFT);
                        }}
                        disabled={busy}
                      >
                        取消
                      </Button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setAddValueFor(g.id);
                      setAddValueDraft(EMPTY_GROUP_DRAFT);
                    }}
                    className="inline-flex items-center gap-1 rounded text-xs text-primary hover:underline focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    新增細項
                  </button>
                )}
              </div>
            )}
          </section>
        );
      })}

      {categoryGroups.length === 0 && category !== "木料" && (
        <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          「{category}」尚未設定任何大項。
        </div>
      )}

      {isAdmin && (
        <div className="rounded-xl border border-dashed border-border bg-card px-4 py-3">
          {addGroupOpen ? (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-foreground">新增「{category}」大項</p>
              <CodeNameSortFields
                idPrefix="grp-add"
                draft={addGroupDraft}
                onChange={(patch) => setAddGroupDraft((d) => ({ ...d, ...patch }))}
                codePlaceholder="例：finish"
                namePlaceholder="例：表面處理"
              />
              <div className="flex flex-wrap gap-2">
                <Button type="button" className="h-8 px-3 text-xs" onClick={() => void submitAddGroup()} disabled={busy}>
                  新增大項
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-8 px-3 text-xs"
                  onClick={() => {
                    setAddGroupOpen(false);
                    setAddGroupDraft(EMPTY_GROUP_DRAFT);
                  }}
                  disabled={busy}
                >
                  取消
                </Button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setAddGroupOpen(true)}
              className="inline-flex items-center gap-1 rounded text-sm text-primary hover:underline focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <Plus className="h-4 w-4" />
              新增「{category}」大項
            </button>
          )}
        </div>
      )}

      <ConfirmDialog
        open={deleteTarget != null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={
          deleteTarget?.kind === "material"
            ? "是否確定刪除此木種？"
            : deleteTarget?.kind === "group"
              ? "是否確定刪除此大項？"
              : "是否確定刪除此細項？"
        }
        description={
          deleteTarget ? (
            <>
              <p className="font-medium text-foreground">{deleteTarget.label}</p>
              <p className="mt-2 text-sm text-muted-foreground">
                {deleteTarget.kind === "material"
                  ? "刪除後新增零件時不再列出此木種；已存在的零件變體不受影響。"
                  : deleteTarget.kind === "group"
                    ? "此大項與其底下所有細項都會一併移除。"
                    : "移除後此細項不再列於選項清單。"}
              </p>
            </>
          ) : null
        }
        confirmLabel="確定刪除"
        onConfirm={performDelete}
        destructive
      />
    </div>
  );
}
