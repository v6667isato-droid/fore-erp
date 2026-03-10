"use client";

import { useEffect, useState, useMemo, type ReactNode } from "react";
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
import * as Dialog from "@radix-ui/react-dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { MessageSquare, Plus, X, ArrowUpDown, ArrowUp, ArrowDown, CalendarPlus } from "lucide-react";
import { toast } from "sonner";

const CATEGORIES = [
  "總覽",
  "訂單管理",
  "客戶資料",
  "生產看板",
  "採購成本",
  "廠商資料",
  "產品資料",
  "通路下單",
  "員工資料",
  "其他",
];

const STATUSES = ["待處理", "處理中", "已解決", "暫緩"];
const PRIORITIES = ["低", "中", "高"];
const REPORTER_OTHER = "__other__";

/** 將描述文字中的 URL 轉成可點擊的超連結 */
function linkifyDescription(text: string): ReactNode {
  const urlPattern = /(https?:\/\/[^\s<>]+|www\.[^\s<>]+)/gi;
  const parts = text.split(urlPattern);
  return (
    <>
      {parts.map((part, i) => {
        const isUrl = part.startsWith("http://") || part.startsWith("https://") || part.startsWith("www.");
        if (isUrl) {
          const href = part.startsWith("www.") ? `https://${part}` : part;
          return (
            <a
              key={i}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline break-all"
              onClick={(e) => e.stopPropagation()}
            >
              {part}
            </a>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

interface FeedbackRow {
  id: string;
  title: string;
  description: string | null;
  category: string;
  status: string;
  priority: string | null;
  reporter: string | null;
  internal_notes: string | null;
  completed_at: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export function FeedbackPage() {
  const [rows, setRows] = useState<FeedbackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterCategory, setFilterCategory] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterCompleted, setFilterCompleted] = useState<"" | "yes" | "no">("");
  const [sortKey, setSortKey] = useState<keyof FeedbackRow | "">("created_at");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteConfirmRow, setDeleteConfirmRow] = useState<FeedbackRow | null>(null);
  const [showDeleted, setShowDeleted] = useState(false);
  const [deletedRows, setDeletedRows] = useState<FeedbackRow[]>([]);
  const [restoreConfirmRow, setRestoreConfirmRow] = useState<FeedbackRow | null>(null);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("待處理");
  const [priority, setPriority] = useState("");
  const [reporterSelect, setReporterSelect] = useState("");
  const [reporterOther, setReporterOther] = useState("");
  const [internalNotes, setInternalNotes] = useState("");
  const [employees, setEmployees] = useState<{ id: string; name: string }[]>([]);
  const [completedDate, setCompletedDate] = useState("");
  const [completedTime, setCompletedTime] = useState("");

  function mapFeedbackRow(r: Record<string, unknown>): FeedbackRow {
    return {
      id: String(r.id),
      title: String(r.title ?? ""),
      description: r.description != null ? String(r.description) : null,
      category: String(r.category ?? ""),
      status: String(r.status ?? "待處理"),
      priority: r.priority != null ? String(r.priority) : null,
      reporter: r.reporter != null ? String(r.reporter) : null,
      internal_notes: r.internal_notes != null ? String(r.internal_notes) : null,
      completed_at: r.completed_at != null ? String(r.completed_at) : null,
      deleted_at: r.deleted_at != null ? String(r.deleted_at) : null,
      created_at: String(r.created_at ?? ""),
      updated_at: String(r.updated_at ?? ""),
    };
  }

  async function fetchFeedback() {
    setLoading(true);
    const { data, error } = await supabase
      .from("user_feedback")
      .select("*")
      .is("deleted_at", null)
      .order("created_at", { ascending: false });
    if (error) {
      toast.error(error.message || "讀取回饋失敗");
      setRows([]);
    } else {
      setRows(((data ?? []) as Record<string, unknown>[]).map(mapFeedbackRow));
    }
    setLoading(false);
  }

  async function fetchDeletedFeedback() {
    const { data, error } = await supabase
      .from("user_feedback")
      .select("*")
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false });
    if (error) {
      toast.error(error.message || "讀取已刪除失敗");
      setDeletedRows([]);
    } else {
      setDeletedRows(((data ?? []) as Record<string, unknown>[]).map(mapFeedbackRow));
    }
  }

  useEffect(() => {
    fetchFeedback();
  }, []);

  useEffect(() => {
    if (showDeleted) fetchDeletedFeedback();
  }, [showDeleted]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("employees")
        .select("id, name")
        .order("name", { ascending: true });
      setEmployees(
        ((data ?? []) as { id: string; name: string }[]).map((e) => ({
          id: String(e.id),
          name: String(e.name ?? ""),
        }))
      );
    })();
  }, []);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      const matchCat = !filterCategory || r.category === filterCategory;
      const matchStatus = !filterStatus || r.status === filterStatus;
      const hasCompleted = r.completed_at != null && r.completed_at !== "";
      const matchCompleted =
        filterCompleted === "" ||
        (filterCompleted === "yes" && hasCompleted) ||
        (filterCompleted === "no" && !hasCompleted);
      return matchCat && matchStatus && matchCompleted;
    });
  }, [rows, filterCategory, filterStatus, filterCompleted]);

  const sortedRows = useMemo(() => {
    if (!sortKey || sortKey === "deleted_at") return [...filtered];
    const isDate = sortKey === "created_at" || sortKey === "completed_at";
    return [...filtered].sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      let cmp = 0;
      if (isDate) {
        const aTime = aVal ? new Date(aVal).getTime() : 0;
        const bTime = bVal ? new Date(bVal).getTime() : 0;
        cmp = aTime - bTime;
      } else {
        const aStr = (aVal ?? "") as string;
        const bStr = (bVal ?? "") as string;
        cmp = aStr.localeCompare(bStr, "zh-TW");
      }
      return sortOrder === "asc" ? cmp : -cmp;
    });
  }, [filtered, sortKey, sortOrder]);

  function toggleSort(key: keyof FeedbackRow) {
    if (key === "id" || key === "description" || key === "internal_notes" || key === "deleted_at") return;
    if (sortKey === key) {
      setSortOrder((o) => (o === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortOrder(key === "created_at" || key === "completed_at" ? "desc" : "asc");
    }
  }

  function SortIcon({ columnKey }: { columnKey: keyof FeedbackRow }) {
    if (sortKey !== columnKey) return <ArrowUpDown className="h-3.5 w-3.5 opacity-50 ml-0.5 inline" />;
    return sortOrder === "asc" ? (
      <ArrowUp className="h-3.5 w-3.5 ml-0.5 inline" />
    ) : (
      <ArrowDown className="h-3.5 w-3.5 ml-0.5 inline" />
    );
  }

  function buildGoogleCalendarUrl(r: FeedbackRow): string | null {
    const dateRaw = r.completed_at || r.created_at;
    if (!dateRaw) return null;
    const d = new Date(dateRaw);
    if (Number.isNaN(d.getTime())) return null;
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const ymd = `${year}${month}${day}`;
    const text = `[回饋] ${(r.title || "未命名").slice(0, 100)}`;
    const detailsLines = [
      r.description ? `描述：${r.description}` : "",
      `類別：${r.category || "—"}`,
      `狀態：${r.status || "—"}`,
    ].filter(Boolean);
    const details = detailsLines.join("\n");
    const params = new URLSearchParams({
      action: "TEMPLATE",
      text,
      dates: `${ymd}/${ymd}`,
      details,
    });
    return `https://calendar.google.com/calendar/render?${params.toString()}`;
  }

  function openCreate() {
    setEditingId(null);
    setTitle("");
    setDescription("");
    setCategory("");
    setStatus("待處理");
    setPriority("");
    setReporterSelect("");
    setReporterOther("");
    setInternalNotes("");
    setCompletedDate("");
    setCompletedTime("");
    setFormOpen(true);
  }

  function openEdit(row: FeedbackRow) {
    setEditingId(row.id);
    setTitle(row.title);
    setDescription(row.description ?? "");
    setCategory(row.category);
    setStatus(row.status);
    setPriority(row.priority ?? "");
    const empNames = employees.map((e) => e.name).filter(Boolean);
    const isEmployee = row.reporter != null && row.reporter !== "" && empNames.includes(row.reporter);
    setReporterSelect((isEmployee ? row.reporter : row.reporter ? REPORTER_OTHER : "") ?? "");
    setReporterOther(isEmployee ? "" : (row.reporter ?? ""));
    setInternalNotes(row.internal_notes ?? "");
    const { date, time } = parseCompletedAt(row.completed_at);
    setCompletedDate(date);
    setCompletedTime(time);
    setFormOpen(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      toast.error("請填寫主旨");
      return;
    }
    if (!category) {
      toast.error("請選擇類別");
      return;
    }
    setSaving(true);
    const payload = {
      title: title.trim(),
      description: description.trim() || null,
      category,
      status: status || "待處理",
      priority: priority.trim() || null,
      reporter: reporterSelect === REPORTER_OTHER ? (reporterOther.trim() || null) : (reporterSelect || null),
      internal_notes: internalNotes.trim() || null,
      completed_at: buildCompletedAtISO(completedDate, completedTime),
      updated_at: new Date().toISOString(),
    };
    if (editingId) {
      const { error } = await supabase
        .from("user_feedback")
        .update(payload)
        .eq("id", editingId);
      if (error) {
        toast.error(error.message || "更新失敗");
        setSaving(false);
        return;
      }
      toast.success("已更新");
    } else {
      const { error } = await supabase.from("user_feedback").insert(payload);
      if (error) {
        toast.error(error.message || "新增失敗");
        setSaving(false);
        return;
      }
      toast.success("已新增");
    }
    setFormOpen(false);
    fetchFeedback();
    setSaving(false);
  }

  function requestDelete(row: FeedbackRow) {
    setDeleteConfirmRow(row);
  }

  async function performDelete() {
    if (!deleteConfirmRow) return;
    const row = deleteConfirmRow;
    setDeleteConfirmRow(null);
    const { error } = await supabase
      .from("user_feedback")
      .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", row.id);
    if (error) {
      toast.error(error.message || "刪除失敗");
      return;
    }
    toast.success("已移至已刪除");
    fetchFeedback();
    if (showDeleted) fetchDeletedFeedback();
  }

  function requestRestore(row: FeedbackRow) {
    setRestoreConfirmRow(row);
  }

  async function performRestore() {
    if (!restoreConfirmRow) return;
    const row = restoreConfirmRow;
    setRestoreConfirmRow(null);
    const { error } = await supabase
      .from("user_feedback")
      .update({ deleted_at: null, updated_at: new Date().toISOString() })
      .eq("id", row.id);
    if (error) {
      toast.error(error.message || "還原失敗");
      return;
    }
    toast.success("已還原");
    fetchFeedback();
    fetchDeletedFeedback();
  }

  function formatDate(s: string) {
    if (!s) return "—";
    try {
      const d = new Date(s);
      return isNaN(d.getTime()) ? s : d.toISOString().slice(0, 16).replace("T", " ");
    } catch {
      return s;
    }
  }

  function parseCompletedAt(iso: string | null): { date: string; time: string } {
    if (!iso) return { date: "", time: "" };
    const d = new Date(iso);
    if (isNaN(d.getTime())) return { date: "", time: "" };
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const h = d.getHours();
    const min = d.getMinutes();
    const time = h === 0 && min === 0 ? "" : `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
    return { date: `${y}-${m}-${day}`, time };
  }

  function buildCompletedAtISO(date: string, time: string): string | null {
    if (!date.trim()) return null;
    const dateTime = time.trim() ? `${date.trim()}T${time.trim()}` : `${date.trim()}T00:00`;
    return new Date(dateTime).toISOString();
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 text-center text-muted-foreground">
        載入回饋中…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <MessageSquare className="h-4 w-4" />
          <span>使用回饋 · 夥伴回報問題，逐筆處理（暫時性功能）</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">類別：全部</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">狀態：全部</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            value={filterCompleted}
            onChange={(e) => setFilterCompleted((e.target.value || "") as "" | "yes" | "no")}
            className="h-9 rounded-md border border-input bg-background px-3 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">完成日期：全部</option>
            <option value="yes">已有完成日期</option>
            <option value="no">尚無完成日期</option>
          </select>
          <Button type="button" className="h-9 px-3 text-xs" onClick={openCreate}>
            <Plus className="h-4 w-4 mr-1" />
            新增
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-9 px-3 text-xs"
            onClick={() => setShowDeleted((v) => !v)}
          >
            {showDeleted ? "隱藏已刪除" : "顯示已刪除項目"}
          </Button>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead
                className="text-xs font-semibold cursor-pointer hover:bg-accent/50 select-none"
                onClick={() => toggleSort("title")}
              >
                主旨 <SortIcon columnKey="title" />
              </TableHead>
              <TableHead
                className="text-xs font-semibold hidden sm:table-cell cursor-pointer hover:bg-accent/50 select-none"
                onClick={() => toggleSort("category")}
              >
                類別 <SortIcon columnKey="category" />
              </TableHead>
              <TableHead
                className="text-xs font-semibold hidden sm:table-cell cursor-pointer hover:bg-accent/50 select-none"
                onClick={() => toggleSort("status")}
              >
                狀態 <SortIcon columnKey="status" />
              </TableHead>
              <TableHead
                className="text-xs font-semibold hidden sm:table-cell cursor-pointer hover:bg-accent/50 select-none"
                onClick={() => toggleSort("priority")}
              >
                優先級 <SortIcon columnKey="priority" />
              </TableHead>
              <TableHead
                className="text-xs font-semibold hidden sm:table-cell cursor-pointer hover:bg-accent/50 select-none"
                onClick={() => toggleSort("reporter")}
              >
                回報人 <SortIcon columnKey="reporter" />
              </TableHead>
              <TableHead
                className="text-xs font-semibold hidden sm:table-cell cursor-pointer hover:bg-accent/50 select-none"
                onClick={() => toggleSort("completed_at")}
              >
                完成日期 <SortIcon columnKey="completed_at" />
              </TableHead>
              <TableHead
                className="text-xs font-semibold hidden sm:table-cell cursor-pointer hover:bg-accent/50 select-none"
                onClick={() => toggleSort("created_at")}
              >
                建立時間 <SortIcon columnKey="created_at" />
              </TableHead>
              <TableHead className="text-xs font-semibold w-36">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                  尚無回饋，或不符合篩選條件。
                </TableCell>
              </TableRow>
            ) : (
              sortedRows.map((r) => {
                const calendarUrl = buildGoogleCalendarUrl(r);
                return (
                <TableRow key={r.id} className="border-b border-border">
                  <TableCell className="text-sm">
                    <div className="font-medium">{r.title}</div>
                    {r.description && (
                      <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                        {linkifyDescription(r.description)}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground hidden sm:table-cell">
                    {r.category || "—"}
                  </TableCell>
                  <TableCell className="text-sm hidden sm:table-cell">{r.status}</TableCell>
                  <TableCell className="text-sm text-muted-foreground hidden sm:table-cell">
                    {r.priority || "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground hidden sm:table-cell">
                    {r.reporter || "—"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground hidden sm:table-cell whitespace-nowrap">
                    {formatDate(r.completed_at ?? "") || "—"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground hidden sm:table-cell whitespace-nowrap">
                    {formatDate(r.created_at)}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1 flex-nowrap">
                      {calendarUrl && (
                        <a
                          href={calendarUrl}
                          target="_blank"
                          rel="noreferrer"
                          title="加到 Google 行事曆"
                          className="inline-flex h-8 items-center justify-center rounded-md px-2 text-xs font-medium hover:bg-accent hover:text-accent-foreground"
                        >
                          <CalendarPlus className="h-3.5 w-3.5 mr-1" />
                          同步
                        </a>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-8 px-2 text-xs"
                        onClick={() => openEdit(r)}
                      >
                        編輯
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-8 px-2 text-xs text-destructive hover:text-destructive"
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); requestDelete(r); }}
                      >
                        刪除
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <p className="text-xs text-muted-foreground">
        顯示 {filtered.length} / {rows.length} 筆
      </p>

      {showDeleted && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="border-b border-border px-4 py-2 text-xs font-medium text-muted-foreground">
            已刪除項目（還原需管理員確認）
          </div>
          {deletedRows.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">尚無已刪除的回饋</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-xs font-semibold p-2">主旨</TableHead>
                  <TableHead className="text-xs font-semibold p-2">刪除時間</TableHead>
                  <TableHead className="text-xs font-semibold p-2 w-24">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deletedRows.map((r) => (
                  <TableRow key={r.id} className="border-b border-border">
                    <TableCell className="text-sm p-2">{r.title || "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground p-2 whitespace-nowrap">
                      {formatDate(r.deleted_at ?? "") || "—"}
                    </TableCell>
                    <TableCell className="p-2">
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-8 px-2 text-xs"
                        onClick={() => requestRestore(r)}
                      >
                        還原
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      )}

      <Dialog.Root open={formOpen} onOpenChange={setFormOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-card p-6 shadow-lg focus:outline-none">
            <div className="flex items-center justify-between mb-4">
              <Dialog.Title className="text-base font-semibold text-foreground">
                {editingId ? "編輯回饋" : "新增回饋"}
              </Dialog.Title>
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="rounded-md p-2 hover:bg-accent/50 focus:outline-none focus:ring-2 focus:ring-ring"
                  aria-label="關閉"
                >
                  <X className="h-4 w-4 text-muted-foreground" />
                </button>
              </Dialog.Close>
            </div>
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">主旨 *</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="簡短描述問題"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">問題描述</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="遇到什麼狀況、在哪一頁、希望怎麼改…"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">類別（左側功能）*</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    required
                  >
                    <option value="">請選擇</option>
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">狀態</label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">優先級</label>
                  <select
                    value={priority}
                    onChange={(e) => setPriority(e.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="">—</option>
                    {PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">回報人</label>
                  <select
                    value={reporterSelect}
                    onChange={(e) => setReporterSelect(e.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="">請選擇</option>
                    {employees.map((emp) => (
                      <option key={emp.id} value={emp.name}>
                        {emp.name}
                      </option>
                    ))}
                    <option value={REPORTER_OTHER}>其他</option>
                  </select>
                  {reporterSelect === REPORTER_OTHER && (
                    <input
                      type="text"
                      value={reporterOther}
                      onChange={(e) => setReporterOther(e.target.value)}
                      className="mt-2 h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                      placeholder="輸入回報人姓名或 email"
                    />
                  )}
                </div>
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex-1 min-w-[140px]">
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">完成日期</label>
                  <input
                    type="date"
                    value={completedDate}
                    onChange={(e) => setCompletedDate(e.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                <div className="flex-1 min-w-[100px]">
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">時間（選填）</label>
                  <input
                    type="time"
                    value={completedTime}
                    onChange={(e) => setCompletedTime(e.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              </div>
              <span className="text-xs text-muted-foreground block -mt-1">問題解決時可填寫，不填時間則視為當日 00:00</span>
              {editingId && (
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">內部備註</label>
                  <textarea
                    value={internalNotes}
                    onChange={(e) => setInternalNotes(e.target.value)}
                    rows={2}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    placeholder="處理方式、已修正說明…"
                  />
                </div>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <Dialog.Close asChild>
                  <Button type="button" variant="outline" disabled={saving}>
                    取消
                  </Button>
                </Dialog.Close>
                <Button type="submit" disabled={saving}>
                  {saving ? "儲存中…" : "儲存"}
                </Button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <ConfirmDialog
        open={deleteConfirmRow != null}
        onOpenChange={(open) => !open && setDeleteConfirmRow(null)}
        title="是否確定刪除？"
        description={
          deleteConfirmRow ? (
            <>
              <p className="font-medium text-foreground">回饋：「{deleteConfirmRow.title}」</p>
              <p className="mt-2 text-muted-foreground">將移至已刪除，可於「顯示已刪除項目」中由管理員確認後還原。</p>
            </>
          ) : null
        }
        confirmLabel="確定刪除"
        onConfirm={performDelete}
        destructive
      />

      <ConfirmDialog
        open={restoreConfirmRow != null}
        onOpenChange={(open) => !open && setRestoreConfirmRow(null)}
        title="還原（僅限管理員確認）"
        description={
          restoreConfirmRow ? (
            <>
              <p className="font-medium text-foreground">回饋：「{restoreConfirmRow.title}」</p>
              <p className="mt-2 text-muted-foreground">僅限管理員確認後執行還原。確定要還原此項目嗎？</p>
            </>
          ) : null
        }
        confirmLabel="確認還原"
        onConfirm={performRestore}
      />
    </div>
  );
}
