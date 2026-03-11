"use client";

import { useEffect, useState } from "react";
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
import { Pencil, Trash2, X } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "sonner";
import { TABLE_PRODUCT_SERIES } from "@/lib/products-db";
import type { SeriesRow } from "@/types/products";

export interface ChannelRow {
  id: string;
  name: string;
  created_at: string | null;
  portal_code: string | null;
  portal_password: string | null;
}

const CHANNEL_SELECT = "id, name, created_at, portal_code, portal_password";

function mapChannelRow(r: Record<string, unknown>): ChannelRow {
  return {
    id: String(r.id),
    name: String(r.name ?? ""),
    created_at: r.created_at != null ? String(r.created_at) : null,
    portal_code: r.portal_code != null ? String(r.portal_code) : null,
    portal_password: r.portal_password != null ? String(r.portal_password) : null,
  };
}

export function ChannelsPage() {
  const [records, setRecords] = useState<ChannelRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editRow, setEditRow] = useState<ChannelRow | null>(null);
  const [deleteConfirmRow, setDeleteConfirmRow] = useState<ChannelRow | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [discountChannel, setDiscountChannel] = useState<ChannelRow | null>(null);

  async function fetchChannels() {
    setLoading(true);
    const { data, error } = await supabase
      .from("channels")
      .select(CHANNEL_SELECT)
      .order("portal_code", { ascending: true })
      .order("name", { ascending: true });
    setLoading(false);
    if (error) {
      toast.error(error.message || "載入通路失敗");
      return;
    }
    setRecords(((data ?? []) as Record<string, unknown>[]).map(mapChannelRow));
  }

  useEffect(() => {
    fetchChannels();
  }, []);

  function requestDelete(row: ChannelRow) {
    setDeleteConfirmRow(row);
  }

  async function performDelete() {
    if (!deleteConfirmRow) return;
    const { error } = await supabase.from("channels").delete().eq("id", deleteConfirmRow.id);
    if (error) {
      toast.error(error.message || "刪除失敗");
      return;
    }
    toast.success("已刪除通路");
    setDeleteConfirmRow(null);
    fetchChannels();
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        載入中…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-lg font-semibold text-foreground">通路管理</h1>
        <div className="flex flex-nowrap items-center gap-2">
          <Button onClick={() => setAddOpen(true)}>新增通路</Button>
        </div>
      </div>
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="relative w-full overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>通路名稱</TableHead>
                <TableHead>登入代碼</TableHead>
                <TableHead className="w-[200px] text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {records.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                    尚無通路，請點「新增通路」新增
                  </TableCell>
                </TableRow>
              ) : (
                records.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell>{row.portal_code ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-nowrap justify-end gap-1">
                        <Button
                          type="button"
                          variant="outline"
                          className="h-8 px-3 text-xs"
                          onClick={() => setDiscountChannel(row)}
                        >
                          系列折扣
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => setEditRow(row)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            requestDelete(row);
                          }}
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
      </div>

      <AddChannelDialog open={addOpen} onOpenChange={setAddOpen} onSuccess={fetchChannels} />
      <EditChannelDialog
        open={!!editRow}
        onOpenChange={(open) => !open && setEditRow(null)}
        row={editRow}
        onSuccess={() => {
          setEditRow(null);
          fetchChannels();
        }}
      />
      <ConfirmDialog
        open={!!deleteConfirmRow}
        onOpenChange={(open) => !open && setDeleteConfirmRow(null)}
        title="確定刪除通路？"
        description={
          deleteConfirmRow ? (
            <>刪除「{deleteConfirmRow.name}」後無法復原，確定要刪除嗎？</>
          ) : null
        }
        confirmLabel="確定刪除"
        destructive
        onConfirm={performDelete}
      />

      <ChannelSeriesDiscountDialog
        open={!!discountChannel}
        onOpenChange={(open) => !open && setDiscountChannel(null)}
        channel={discountChannel}
        onSuccess={() => {
          setDiscountChannel(null);
        }}
      />
    </div>
  );
}

// ----- Add Channel Dialog -----

interface AddChannelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

function AddChannelDialog({ open, onOpenChange, onSuccess }: AddChannelDialogProps) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [portalCode, setPortalCode] = useState("");
  const [portalPassword, setPortalPassword] = useState("");

  function reset() {
    setName("");
    setPortalCode("");
    setPortalPassword("");
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    const payload = {
      name: name.trim(),
      portal_code: portalCode.trim() || null,
      portal_password: portalPassword.trim() || null,
    };
    const { error } = await supabase.from("channels").insert(payload);
    setSaving(false);
    if (error) {
      toast.error(error.message || "新增失敗");
      return;
    }
    toast.success("已新增通路");
    handleOpenChange(false);
    onSuccess();
  }

  return (
    <ChannelFormDialog
      open={open}
      onOpenChange={handleOpenChange}
      title="新增通路"
      name={name}
      setName={setName}
      portalCode={portalCode}
      setPortalCode={setPortalCode}
      portalPassword={portalPassword}
      setPortalPassword={setPortalPassword}
      saving={saving}
      onSubmit={onSubmit}
      submitLabel="新增"
    />
  );
}

// ----- Edit Channel Dialog -----

interface EditChannelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: ChannelRow | null;
  onSuccess: () => void;
}

function EditChannelDialog({ open, onOpenChange, row, onSuccess }: EditChannelDialogProps) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [portalCode, setPortalCode] = useState("");
  const [portalPassword, setPortalPassword] = useState("");

  useEffect(() => {
    if (open && row) {
      setName(row.name);
      setPortalCode(row.portal_code ?? "");
      setPortalPassword(row.portal_password ?? "");
    }
  }, [open, row]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!row || !name.trim()) return;
    setSaving(true);
    const payload = {
      name: name.trim(),
      portal_code: portalCode.trim() || null,
      portal_password: portalPassword.trim() || null,
    };
    const { error } = await supabase.from("channels").update(payload).eq("id", row.id);
    setSaving(false);
    if (error) {
      toast.error(error.message || "更新失敗");
      return;
    }
    toast.success("已更新通路");
    onOpenChange(false);
    onSuccess();
  }

  if (!row) return null;

  return (
    <ChannelFormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="編輯通路"
      name={name}
      setName={setName}
      portalCode={portalCode}
      setPortalCode={setPortalCode}
      portalPassword={portalPassword}
      setPortalPassword={setPortalPassword}
      saving={saving}
      onSubmit={onSubmit}
      submitLabel="儲存"
    />
  );
}

// ----- Shared form dialog -----

interface ChannelFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  name: string;
  setName: (v: string) => void;
  portalCode: string;
  setPortalCode: (v: string) => void;
  portalPassword: string;
  setPortalPassword: (v: string) => void;
  saving: boolean;
  onSubmit: (e: React.FormEvent) => void;
  submitLabel: string;
}

function ChannelFormDialog({
  open,
  onOpenChange,
  title,
  name,
  setName,
  portalCode,
  setPortalCode,
  portalPassword,
  setPortalPassword,
  saving,
  onSubmit,
  submitLabel,
}: ChannelFormDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card p-5 shadow-lg focus:outline-none"
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <div className="flex items-center justify-between gap-4 mb-4">
            <Dialog.Title className="text-base font-semibold text-foreground">{title}</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-accent/40" aria-label="關閉">
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </Dialog.Close>
          </div>
          <form onSubmit={onSubmit} className="space-y-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-muted-foreground">通路名稱 *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                required
              />
            </div>
            <div className="border-t border-border pt-3 space-y-2">
              <p className="text-xs font-medium text-muted-foreground">通路下單入口（選填）</p>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-muted-foreground">通路代碼</label>
                <input
                  type="text"
                  value={portalCode}
                  onChange={(e) => setPortalCode(e.target.value)}
                  className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                  placeholder="供通路商登入 /portal 使用，需唯一"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-muted-foreground">通路密碼</label>
                <input
                  type="password"
                  value={portalPassword}
                  onChange={(e) => setPortalPassword(e.target.value)}
                  className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                  placeholder="登入時輸入的密碼"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Dialog.Close asChild>
                <Button type="button" variant="outline">取消</Button>
              </Dialog.Close>
              <Button type="submit" disabled={saving}>
                {saving ? "處理中…" : submitLabel}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ----- Channel × Series discount dialog -----

interface ChannelSeriesDiscountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channel: ChannelRow | null;
  onSuccess: () => void;
}

type MinimalSeries = Pick<SeriesRow, "id" | "name" | "category">;

function ChannelSeriesDiscountDialog({
  open,
  onOpenChange,
  channel,
  onSuccess,
}: ChannelSeriesDiscountDialogProps) {
  const [seriesList, setSeriesList] = useState<MinimalSeries[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !channel) return;
    setLoading(true);
    setError(null);
    (async () => {
      // 讀取所有系列（只需要 id / name / category）
      let seriesData: Record<string, unknown>[] | null = null;
      const res = await supabase
        .from(TABLE_PRODUCT_SERIES)
        .select("id, name, category")
        .order("id", { ascending: true });
      if (res.error) {
        if (/name/i.test(res.error.message ?? "")) {
          const alt = await supabase
            .from(TABLE_PRODUCT_SERIES)
            .select("id, series_name, category")
            .order("id", { ascending: true });
          if (!alt.error) {
            seriesData = alt.data as Record<string, unknown>[];
          }
        }
        if (!seriesData) {
          setError(res.error.message || "讀取系列失敗");
          setLoading(false);
          return;
        }
      } else {
        seriesData = (res.data ?? []) as Record<string, unknown>[];
      }

      const mapped: MinimalSeries[] = (seriesData ?? []).map((r) => {
        const nameVal = (r as any).name ?? (r as any).series_name;
        return {
          id: String(r.id),
          name: String(nameVal ?? ""),
          category: String((r as any).category ?? ""),
        };
      });

      // 讀取該通路既有折扣
      const { data: discountData, error: discountErr } = await supabase
        .from("product_series_channel_discounts")
        .select("series_id, discount_percent")
        .eq("channel_id", channel.id);
      if (discountErr) {
        setError(discountErr.message || "讀取折扣設定失敗");
        setLoading(false);
        setSeriesList(mapped);
        return;
      }
      const map: Record<string, string> = {};
      mapped.forEach((s) => {
        map[s.id] = "";
      });
      (discountData ?? []).forEach((row: any) => {
        const sid = String(row.series_id);
        const val = row.discount_percent != null ? String(row.discount_percent) : "";
        map[sid] = val;
      });
      setSeriesList(mapped);
      setValues(map);
      setLoading(false);
    })();
  }, [open, channel]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!channel) return;
    setSaving(true);
    setError(null);
    try {
      for (const s of seriesList) {
        const raw = (values[s.id] ?? "").trim();
        if (!raw) {
          await supabase
            .from("product_series_channel_discounts")
            .delete()
            .eq("series_id", s.id)
            .eq("channel_id", channel.id);
          continue;
        }
        const num = Number(raw);
        if (!Number.isFinite(num) || num < 0 || num > 100) {
          throw new Error(`系列「${s.name || "未命名"}」折扣必須是 0–100 的數字`);
        }
        const { error: upsertErr } = await supabase
          .from("product_series_channel_discounts")
          .upsert(
            {
              series_id: s.id,
              channel_id: channel.id,
              discount_percent: num,
            },
            { onConflict: "series_id,channel_id" }
          );
        if (upsertErr) {
          throw new Error(`系列「${s.name || "未命名"}」折扣儲存失敗：${upsertErr.message}`);
        }
      }
      toast.success("已更新系列折扣");
      onOpenChange(false);
      onSuccess();
    } catch (err: any) {
      setError(err?.message || "儲存系列折扣失敗");
    } finally {
      setSaving(false);
    }
  }

  if (!channel) return null;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-lg focus:outline-none"
          onCloseAutoFocus={(e) => e.preventDefault()}
          aria-describedby="channel-series-discount-desc"
        >
          <div className="flex items-start justify-between gap-4 mb-3">
            <div>
              <Dialog.Title className="text-base font-semibold text-foreground">
                通路系列折扣設定
              </Dialog.Title>
              <p id="channel-series-discount-desc" className="mt-1 text-sm text-muted-foreground">
                針對此通路，為各產品系列設定折扣百分比。會影響該系列所有規格在此通路的售價。
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                例如輸入 20 表示 8 折（base price × (1 - 20% )）。
              </p>
              <p className="mt-2 text-xs text-foreground">通路：{channel.name}</p>
            </div>
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
          <form onSubmit={handleSubmit} className="space-y-3">
            {loading ? (
              <p className="text-sm text-muted-foreground">載入系列與折扣中…</p>
            ) : seriesList.length === 0 ? (
              <p className="text-sm text-muted-foreground">目前尚未建立任何產品系列。</p>
            ) : (
              <div className="max-h-[55vh] overflow-y-auto rounded-lg border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-40 text-xs font-semibold">系列名稱</TableHead>
                      <TableHead className="w-24 text-xs font-semibold">類別</TableHead>
                      <TableHead className="text-xs font-semibold">折扣（%）</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {seriesList.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell className="text-sm">{s.name || "未命名"}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {s.category || "—"}
                        </TableCell>
                        <TableCell className="text-sm">
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              min={0}
                              max={100}
                              step="any"
                              value={values[s.id] ?? ""}
                              onChange={(e) =>
                                setValues((prev) => ({ ...prev, [s.id]: e.target.value }))
                              }
                              className="h-8 w-32 rounded-lg border border-input bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                              placeholder="未設定"
                            />
                            <span className="text-xs text-muted-foreground">%</span>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            {error && (
              <p className="text-xs text-destructive" role="alert">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Dialog.Close asChild>
                <Button type="button" variant="ghost" disabled={saving}>
                  取消
                </Button>
              </Dialog.Close>
              <Button type="submit" disabled={saving || loading || seriesList.length === 0}>
                {saving ? "儲存中…" : "儲存"}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
