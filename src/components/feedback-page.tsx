"use client";

import { useEffect, useState, useMemo } from "react";
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
import { MessageSquare, Plus, Pencil, Trash2, X } from "lucide-react";
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
  created_at: string;
  updated_at: string;
}

export function FeedbackPage() {
  const [rows, setRows] = useState<FeedbackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterCategory, setFilterCategory] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterCompleted, setFilterCompleted] = useState<"" | "yes" | "no">("");
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("待處理");
  const [priority, setPriority] = useState("");
  const [reporter, setReporter] = useState("");
  const [internalNotes, setInternalNotes] = useState("");
  const [completedAt, setCompletedAt] = useState("");

  async function fetchFeedback() {
    setLoading(true);
    const { data, error } = await supabase
      .from("user_feedback")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      toast.error(error.message || "讀取回饋失敗");
      setRows([]);
    } else {
      setRows(
        ((data ?? []) as any[]).map((r) => ({
          id: String(r.id),
          title: String(r.title ?? ""),
          description: r.description != null ? String(r.description) : null,
          category: String(r.category ?? ""),
          status: String(r.status ?? "待處理"),
          priority: r.priority != null ? String(r.priority) : null,
          reporter: r.reporter != null ? String(r.reporter) : null,
          internal_notes: r.internal_notes != null ? String(r.internal_notes) : null,
          completed_at: r.completed_at != null ? String(r.completed_at) : null,
          created_at: String(r.created_at ?? ""),
          updated_at: String(r.updated_at ?? ""),
        }))
      );
    }
    setLoading(false);
  }

  useEffect(() => {
    fetchFeedback();
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

  function openCreate() {
    setEditingId(null);
    setTitle("");
    setDescription("");
    setCategory("");
    setStatus("待處理");
    setPriority("");
    setReporter("");
    setInternalNotes("");
    setCompletedAt("");
    setFormOpen(true);
  }

  function openEdit(row: FeedbackRow) {
    setEditingId(row.id);
    setTitle(row.title);
    setDescription(row.description ?? "");
    setCategory(row.category);
    setStatus(row.status);
    setPriority(row.priority ?? "");
    setReporter(row.reporter ?? "");
    setInternalNotes(row.internal_notes ?? "");
    setCompletedAt(toDatetimeLocal(row.completed_at));
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
      reporter: reporter.trim() || null,
      internal_notes: internalNotes.trim() || null,
      completed_at: completedAt.trim() ? new Date(completedAt.trim()).toISOString() : null,
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

  async function handleDelete(row: FeedbackRow) {
    if (!confirm(`確定要刪除「${row.title}」？`)) return;
    const { error } = await supabase.from("user_feedback").delete().eq("id", row.id);
    if (error) {
      toast.error(error.message || "刪除失敗");
      return;
    }
    toast.success("已刪除");
    fetchFeedback();
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

  function toDatetimeLocal(iso: string | null): string {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const h = String(d.getHours()).padStart(2, "0");
    const min = String(d.getMinutes()).padStart(2, "0");
    return `${y}-${m}-${day}T${h}:${min}`;
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
            新增回饋
          </Button>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="text-xs font-semibold">主旨</TableHead>
              <TableHead className="text-xs font-semibold hidden sm:table-cell">類別</TableHead>
              <TableHead className="text-xs font-semibold hidden sm:table-cell">狀態</TableHead>
              <TableHead className="text-xs font-semibold hidden sm:table-cell">優先級</TableHead>
              <TableHead className="text-xs font-semibold hidden sm:table-cell">回報人</TableHead>
              <TableHead className="text-xs font-semibold hidden sm:table-cell">完成日期</TableHead>
              <TableHead className="text-xs font-semibold hidden sm:table-cell">建立時間</TableHead>
              <TableHead className="text-xs font-semibold w-24">操作</TableHead>
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
              filtered.map((r) => (
                <TableRow key={r.id} className="border-b border-border">
                  <TableCell className="text-sm">
                    <div className="font-medium">{r.title}</div>
                    {r.description && (
                      <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                        {r.description}
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
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-8 px-2 text-xs"
                        onClick={() => openEdit(r)}
                      >
                        <Pencil className="h-3.5 w-3.5 mr-1" />
                        編輯
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-8 px-2 text-xs text-destructive hover:text-destructive"
                        onClick={() => handleDelete(r)}
                      >
                        <Trash2 className="h-3.5 w-3.5 mr-1" />
                        刪除
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <p className="text-xs text-muted-foreground">
        顯示 {filtered.length} / {rows.length} 筆
      </p>

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
                  <input
                    type="text"
                    value={reporter}
                    onChange={(e) => setReporter(e.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    placeholder="email 或名稱"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">完成日期</label>
                <input
                  type="datetime-local"
                  value={completedAt}
                  onChange={(e) => setCompletedAt(e.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <span className="text-xs text-muted-foreground mt-0.5 block">問題解決時可填寫</span>
              </div>
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
    </div>
  );
}
