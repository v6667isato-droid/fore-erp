"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  TABLE_JOURNAL_POSTS,
  JOURNAL_POST_SELECT,
  JOURNAL_TAG_LABEL,
  mapJournalPost,
  type JournalPostRow,
} from "@/lib/journal-db";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { JournalPostFormDialog } from "@/components/journal/journal-post-form-dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "sonner";

type SortKey = "post_code" | "title_zh" | "tag" | "post_date" | "published";

/** 官網日誌管理：文章列表、發佈開關、新增與編輯 */
export function JournalPage() {
  const [rows, setRows] = useState<JournalPostRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filterTag, setFilterTag] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: "post_date", asc: false });
  const [addOpen, setAddOpen] = useState(false);
  const [editRow, setEditRow] = useState<JournalPostRow | null>(null);
  const [deleteConfirmRow, setDeleteConfirmRow] = useState<JournalPostRow | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const { data, error } = await supabase
      .from(TABLE_JOURNAL_POSTS)
      .select(JOURNAL_POST_SELECT)
      .is("deleted_at", null)
      .order("post_date", { ascending: false });
    if (error) {
      setLoadError(error.message || "無法讀取日誌文章");
      setRows([]);
    } else {
      setRows(((data ?? []) as unknown as Record<string, unknown>[]).map(mapJournalPost));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const filteredRows = useMemo(() => {
    if (!filterTag) return rows;
    return rows.filter((r) => r.tag === filterTag);
  }, [rows, filterTag]);

  const sortedRows = useMemo(() => {
    const base = [...filteredRows];
    const ascFactor = sort.asc ? 1 : -1;
    base.sort((a, b) => {
      if (sort.key === "published") {
        return ascFactor * (Number(a.published) - Number(b.published));
      }
      const aVal = a[sort.key] ?? "";
      const bVal = b[sort.key] ?? "";
      return ascFactor * String(aVal).localeCompare(String(bVal));
    });
    return base;
  }, [filteredRows, sort]);

  async function performDelete() {
    if (!deleteConfirmRow) return;
    const row = deleteConfirmRow;
    setDeleteConfirmRow(null);
    const { error } = await supabase
      .from(TABLE_JOURNAL_POSTS)
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", row.id);
    if (error) {
      toast.error(error.message || "刪除失敗");
      return;
    }
    toast.success("已刪除日誌文章");
    setEditRow(null);
    void fetchData();
  }

  async function togglePublished(row: JournalPostRow) {
    const next = !row.published;
    const { error } = await supabase
      .from(TABLE_JOURNAL_POSTS)
      .update({ published: next })
      .eq("id", row.id);
    if (error) {
      toast.error(error.message || "更新發佈狀態失敗");
      return;
    }
    toast.success(next ? "已發佈到官網" : "已取消官網發佈");
    void fetchData();
  }

  function sortButton(key: SortKey, label: string) {
    return (
      <button
        type="button"
        className="inline-flex items-center gap-1.5 hover:text-primary"
        onClick={() =>
          setSort((prev) => ({ key, asc: prev.key === key ? !prev.asc : true }))
        }
        aria-label={`依${label}排序（目前為${sort.key === key && !sort.asc ? "降冪" : "升冪"}）`}
      >
        <span>{label}</span>
        <span className="inline-flex items-center justify-center h-4 w-4 text-sm leading-none text-muted-foreground">
          {sort.key === key ? (sort.asc ? "↑" : "↓") : "–"}
        </span>
      </button>
    );
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 text-center text-muted-foreground">
        載入日誌文章中…
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="rounded-xl border border-destructive/50 bg-destructive/5 p-5 space-y-3">
        <p className="font-medium text-foreground">無法讀取日誌文章</p>
        <p className="text-sm text-destructive break-all">{loadError}</p>
        <Button variant="outline" className="h-8 px-3 text-xs" onClick={() => void fetchData()}>
          重新載入
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-muted-foreground">
          發佈中的文章會顯示在官網 Journal 頁面。
          <span className="ml-2">共 {rows.length} 筆</span>
        </div>
        <Button className="h-9 shrink-0 gap-2 px-4 text-sm" variant="outline" onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4" />
          新增文章
        </Button>
      </div>

      <div className="rounded-xl border border-border bg-card overflow-x-auto">
        <div className="flex flex-wrap items-center gap-3 border-b border-border bg-muted/20 px-4 py-3">
          <span className="text-xs font-medium text-muted-foreground shrink-0">篩選分類</span>
          <select
            value={filterTag}
            onChange={(e) => setFilterTag(e.target.value)}
            className="h-8 min-w-[7rem] rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label="依分類篩選"
          >
            <option value="">全部</option>
            {(Object.keys(JOURNAL_TAG_LABEL) as (keyof typeof JOURNAL_TAG_LABEL)[]).map((t) => (
              <option key={t} value={t}>{JOURNAL_TAG_LABEL[t]}</option>
            ))}
          </select>
          <span className="text-xs text-muted-foreground ml-auto">共 {filteredRows.length} 筆</span>
        </div>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent border-b border-border">
              <TableHead className="text-xs font-semibold p-2 w-16">主圖</TableHead>
              <TableHead className="text-xs font-semibold p-2">{sortButton("post_code", "編號")}</TableHead>
              <TableHead className="text-xs font-semibold p-2">{sortButton("title_zh", "標題")}</TableHead>
              <TableHead className="text-xs font-semibold p-2">{sortButton("tag", "分類")}</TableHead>
              <TableHead className="text-xs font-semibold p-2">{sortButton("post_date", "日期")}</TableHead>
              <TableHead className="text-xs font-semibold p-2">{sortButton("published", "官網")}</TableHead>
              <TableHead className="text-xs font-semibold p-2 min-w-[90px] text-right" aria-label="操作">
                操作
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                  {rows.length === 0
                    ? "尚無日誌文章，請點「新增文章」建立。"
                    : "無符合篩選條件的資料。"}
                </TableCell>
              </TableRow>
            ) : (
              sortedRows.map((row) => (
                <TableRow key={row.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                  <TableCell className="p-2 align-middle">
                    {row.image_url ? (
                      <span className="inline-flex h-10 w-10 items-center justify-center overflow-hidden rounded-md border border-border bg-muted">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={row.image_url}
                          alt={row.title_zh || "主圖"}
                          className="h-full w-full object-cover"
                        />
                      </span>
                    ) : (
                      <span className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-dashed border-muted text-[10px] text-muted-foreground">
                        無圖
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm p-2">{row.post_code}</TableCell>
                  <TableCell className="text-sm font-medium p-2">
                    <button
                      type="button"
                      onClick={() => setEditRow(row)}
                      className="text-left text-primary hover:underline focus:outline-none focus:ring-2 focus:ring-ring rounded"
                    >
                      <span className="flex flex-col">
                        <span>{row.title_zh || "—"}</span>
                        {row.title_en?.trim() && (
                          <span className="mt-0.5 text-[11px] font-normal text-muted-foreground">
                            {row.title_en}
                          </span>
                        )}
                      </span>
                    </button>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground p-2">
                    {JOURNAL_TAG_LABEL[row.tag]}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground p-2">{row.post_date}</TableCell>
                  <TableCell className="p-2">
                    <button
                      type="button"
                      onClick={() => void togglePublished(row)}
                      className="focus:outline-none focus:ring-2 focus:ring-ring rounded"
                      aria-label={row.published ? `取消發佈 ${row.title_zh}` : `發佈 ${row.title_zh} 到官網`}
                      title={row.published ? "點擊取消官網發佈" : "點擊發佈到官網"}
                    >
                      {row.published ? (
                        <Badge>發佈中</Badge>
                      ) : (
                        <Badge variant="secondary">未發佈</Badge>
                      )}
                    </button>
                  </TableCell>
                  <TableCell className="p-2 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditRow(row)} aria-label={`編輯 ${row.title_zh}`}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => setDeleteConfirmRow(row)}
                        aria-label={`刪除 ${row.title_zh}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <JournalPostFormDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        row={null}
        onSuccess={() => void fetchData()}
      />
      <JournalPostFormDialog
        open={editRow != null}
        onOpenChange={(open) => !open && setEditRow(null)}
        row={editRow}
        onSuccess={() => {
          setEditRow(null);
          void fetchData();
        }}
      />
      <ConfirmDialog
        open={deleteConfirmRow != null}
        onOpenChange={(open) => !open && setDeleteConfirmRow(null)}
        title="是否確定刪除此日誌文章？"
        description={
          deleteConfirmRow ? (
            <>
              <p className="font-medium text-foreground">
                「{deleteConfirmRow.post_code} · {deleteConfirmRow.title_zh || "未命名"}」
              </p>
              {deleteConfirmRow.published && (
                <p className="mt-2 text-muted-foreground">此文章目前發佈在官網上，刪除後將自官網移除。</p>
              )}
              <p className="mt-2 text-muted-foreground">此操作無法復原。</p>
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
