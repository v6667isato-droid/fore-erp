"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  isSupabaseConfigured,
  supabase,
  SUPABASE_CONFIG_HELP,
} from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Copy, Plus, RefreshCw, Ticket, Trash2, UserPlus } from "lucide-react";
import { NumericInput } from "@/components/ui/numeric-input";

type BotRole = "admin" | "staff";

interface BotUserRow {
  chat_id: string;
  name: string;
  role: string;
  employee_id: string | null;
  is_active: boolean;
  note: string | null;
  created_at: string;
}

interface BotInviteRow {
  id: string;
  code: string;
  role: string;
  employee_id: string | null;
  name: string | null;
  created_at: string;
  expires_at: string;
  used_at: string | null;
  used_by_chat_id: string | null;
}

interface EmployeeOption {
  id: string;
  name: string;
  active: boolean;
}

/** 排除易混淆字元(0/O、1/I/L)的邀請碼,8 碼 */
function generateInviteCode(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
}

function roleLabel(role: string): string {
  return role === "admin" ? "管理者" : "員工";
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 16).replace("T", " ");
  return d.toLocaleString("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function inviteStatus(row: BotInviteRow): "unused" | "used" | "expired" {
  if (row.used_at) return "used";
  if (new Date(row.expires_at).getTime() < Date.now()) return "expired";
  return "unused";
}

const inputCls =
  "h-9 rounded-lg border border-input bg-background px-2 text-sm";

export function TelegramBotUsersPage() {
  const [users, setUsers] = useState<BotUserRow[]>([]);
  const [invites, setInvites] = useState<BotInviteRow[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);

  // 手動新增表單
  const [showAddForm, setShowAddForm] = useState(false);
  const [addChatId, setAddChatId] = useState("");
  const [addName, setAddName] = useState("");
  const [addRole, setAddRole] = useState<BotRole>("staff");
  const [addEmployeeId, setAddEmployeeId] = useState("");

  // 邀請碼表單
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteRole, setInviteRole] = useState<BotRole>("staff");
  const [inviteName, setInviteName] = useState("");
  const [inviteEmployeeId, setInviteEmployeeId] = useState("");
  const [inviteDays, setInviteDays] = useState(7);

  const employeeNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of employees) m.set(e.id, e.name);
    return m;
  }, [employees]);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setError(SUPABASE_CONFIG_HELP);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [usersRes, invitesRes, employeesRes] = await Promise.all([
        supabase
          .from("telegram_bot_users")
          .select("chat_id, name, role, employee_id, is_active, note, created_at")
          .order("created_at", { ascending: true }),
        supabase
          .from("telegram_bot_invites")
          .select(
            "id, code, role, employee_id, name, created_at, expires_at, used_at, used_by_chat_id",
          )
          .order("created_at", { ascending: false }),
        supabase
          .from("employees")
          .select("id, name, employment_status")
          .order("name", { ascending: true }),
      ]);
      if (usersRes.error) {
        setError(usersRes.error.message);
        return;
      }
      if (invitesRes.error) {
        setError(invitesRes.error.message);
        return;
      }
      setUsers((usersRes.data ?? []) as BotUserRow[]);
      setInvites((invitesRes.data ?? []) as BotInviteRow[]);
      setEmployees(
        ((employeesRes.data ?? []) as {
          id: string;
          name: string | null;
          employment_status: boolean | null;
        }[]).map((e) => ({
          id: e.id,
          name: e.name ?? "—",
          active: e.employment_status === true,
        })),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function addUser() {
    const chatId = addChatId.trim();
    const name = addName.trim();
    if (!/^-?\d+$/.test(chatId)) {
      toast.error("chat_id 必須是數字(員工傳訊息給 bot 會收到自己的 ID)");
      return;
    }
    if (!name) {
      toast.error("請輸入顯示名稱");
      return;
    }
    setActingId("add");
    try {
      const { error: err } = await supabase.from("telegram_bot_users").insert({
        chat_id: chatId,
        name,
        role: addRole,
        employee_id: addEmployeeId || null,
        note: "後台手動新增",
      });
      if (err) {
        toast.error(
          /duplicate|unique/i.test(err.message)
            ? "這個 chat_id 已經存在"
            : err.message,
        );
        return;
      }
      toast.success(`已新增 ${name}(權限一分鐘內生效)`);
      setAddChatId("");
      setAddName("");
      setAddRole("staff");
      setAddEmployeeId("");
      setShowAddForm(false);
      await load();
    } finally {
      setActingId(null);
    }
  }

  async function createInvite() {
    const code = generateInviteCode();
    const days = Math.min(Math.max(Math.floor(inviteDays) || 7, 1), 90);
    setActingId("invite");
    try {
      const { error: err } = await supabase.from("telegram_bot_invites").insert({
        code,
        role: inviteRole,
        name: inviteName.trim() || null,
        employee_id: inviteEmployeeId || null,
        expires_at: new Date(Date.now() + days * 86400_000).toISOString(),
      });
      if (err) {
        toast.error(err.message);
        return;
      }
      toast.success(`已產生邀請碼 ${code}`);
      setInviteName("");
      setInviteEmployeeId("");
      setInviteRole("staff");
      setShowInviteForm(false);
      await load();
    } finally {
      setActingId(null);
    }
  }

  async function updateUser(
    chatId: string,
    patch: Partial<Pick<BotUserRow, "role" | "is_active" | "employee_id">>,
    successMessage: string,
  ) {
    setActingId(chatId);
    try {
      const { error: err } = await supabase
        .from("telegram_bot_users")
        .update(patch)
        .eq("chat_id", chatId);
      if (err) {
        toast.error(err.message);
        return;
      }
      toast.success(`${successMessage}(權限一分鐘內生效)`);
      await load();
    } finally {
      setActingId(null);
    }
  }

  async function deleteUser(row: BotUserRow) {
    if (!window.confirm(`確定刪除「${row.name}」?該帳號將立即無法使用 bot。`)) return;
    setActingId(row.chat_id);
    try {
      const { error: err } = await supabase
        .from("telegram_bot_users")
        .delete()
        .eq("chat_id", row.chat_id);
      if (err) {
        toast.error(err.message);
        return;
      }
      toast.success(`已刪除 ${row.name}`);
      await load();
    } finally {
      setActingId(null);
    }
  }

  async function revokeInvite(row: BotInviteRow) {
    if (!window.confirm(`確定撤銷邀請碼 ${row.code}?`)) return;
    setActingId(row.id);
    try {
      const { error: err } = await supabase
        .from("telegram_bot_invites")
        .delete()
        .eq("id", row.id);
      if (err) {
        toast.error(err.message);
        return;
      }
      toast.success("已撤銷邀請碼");
      await load();
    } finally {
      setActingId(null);
    }
  }

  async function copyCode(code: string) {
    try {
      await navigator.clipboard.writeText(`/start ${code}`);
      toast.success(`已複製「/start ${code}」,傳給員工即可`);
    } catch {
      toast.error("複製失敗,請手動複製");
    }
  }

  const employeeSelect = (
    value: string,
    onChange: (v: string) => void,
  ) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={inputCls}>
      <option value="">不綁定員工</option>
      {employees
        .filter((e) => e.active)
        .map((e) => (
          <option key={e.id} value={e.id}>
            {e.name}
          </option>
        ))}
    </select>
  );

  function renderUserRoleSelect(row: BotUserRow) {
    return (
      <select
        value={row.role === "admin" ? "admin" : "staff"}
        disabled={actingId === row.chat_id}
        onChange={(e) =>
          void updateUser(
            row.chat_id,
            { role: e.target.value },
            `已把 ${row.name} 改為${roleLabel(e.target.value)}`,
          )
        }
        aria-label={`${row.name} 的角色`}
        className="h-8 rounded-lg border border-input bg-background px-2 text-xs"
      >
        <option value="staff">員工</option>
        <option value="admin">管理者</option>
      </select>
    );
  }

  function renderUserEmployeeSelect(row: BotUserRow, widthClassName: string) {
    return (
      <select
        value={row.employee_id ?? ""}
        disabled={actingId === row.chat_id}
        onChange={(e) =>
          void updateUser(
            row.chat_id,
            { employee_id: e.target.value || null },
            `已更新 ${row.name} 的員工綁定`,
          )
        }
        aria-label={`${row.name} 綁定的員工`}
        className={cn("h-8 rounded-lg border border-input bg-background px-2 text-xs", widthClassName)}
      >
        <option value="">不綁定</option>
        {employees
          .filter((e) => e.active || e.id === row.employee_id)
          .map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
      </select>
    );
  }

  function renderUserActiveToggle(row: BotUserRow) {
    return (
      <button
        type="button"
        disabled={actingId === row.chat_id}
        onClick={() =>
          void updateUser(
            row.chat_id,
            { is_active: !row.is_active },
            row.is_active ? `已停用 ${row.name}` : `已啟用 ${row.name}`,
          )
        }
        className={cn(
          "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
          row.is_active
            ? "border-emerald-700/25 bg-emerald-100/80 text-emerald-950 hover:bg-emerald-100 dark:border-emerald-500/25 dark:bg-emerald-950/35 dark:text-emerald-100"
            : "border-stone-500/25 bg-stone-200/80 text-stone-600 hover:bg-stone-200 dark:border-stone-500/30 dark:bg-stone-800/60 dark:text-stone-300",
        )}
        title="點擊切換啟用/停用"
      >
        {row.is_active ? "啟用中" : "已停用"}
      </button>
    );
  }

  function renderUserDelete(row: BotUserRow) {
    return (
      <Button
        type="button"
        variant="outline"
        className="h-7 gap-1 border-red-200 bg-red-50/80 px-2 text-xs text-red-800 hover:bg-red-100 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200 dark:hover:bg-red-950/50"
        disabled={actingId === row.chat_id}
        onClick={() => void deleteUser(row)}
      >
        <Trash2 className="h-3 w-3" />
        刪除
      </Button>
    );
  }

  /** 邀請碼的預設名稱，未填則顯示綁定員工 */
  function inviteTargetName(row: BotInviteRow): string {
    return (
      row.name?.trim() ||
      (row.employee_id ? employeeNameById.get(row.employee_id) ?? "—" : "—")
    );
  }

  function renderInviteStatus(row: BotInviteRow, status: ReturnType<typeof inviteStatus>) {
    return status === "used" ? (
      <span className="text-emerald-700 dark:text-emerald-400">
        已使用({formatDateTime(row.used_at)})
      </span>
    ) : status === "expired" ? (
      <span className="text-muted-foreground">已過期</span>
    ) : (
      <span className="text-amber-700 dark:text-amber-400">未使用</span>
    );
  }

  function renderInviteActions(row: BotInviteRow, status: ReturnType<typeof inviteStatus>) {
    return (
      <div className="flex gap-1.5">
        {status === "unused" && (
          <>
            <Button
              type="button"
              variant="outline"
              className="h-7 gap-1 px-2 text-xs"
              onClick={() => void copyCode(row.code)}
            >
              <Copy className="h-3 w-3" />
              複製
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-7 gap-1 border-red-200 bg-red-50/80 px-2 text-xs text-red-800 hover:bg-red-100 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200 dark:hover:bg-red-950/50"
              disabled={actingId === row.id}
              onClick={() => void revokeInvite(row)}
            >
              <Trash2 className="h-3 w-3" />
              撤銷
            </Button>
          </>
        )}
        {status !== "unused" && (
          <Button
            type="button"
            variant="outline"
            className="h-7 gap-1 px-2 text-xs"
            disabled={actingId === row.id}
            onClick={() => void revokeInvite(row)}
          >
            <Trash2 className="h-3 w-3" />
            刪除
          </Button>
        )}
      </div>
    );
  }

  if (!isSupabaseConfigured) {
    return (
      <div className="rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
        {SUPABASE_CONFIG_HELP}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="rounded-xl border border-border bg-muted/20 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
        員工加入方式(二擇一):
        <br />
        ① <span className="font-medium text-foreground">邀請碼</span>
        :產生邀請碼後把「/start 邀請碼」傳給員工,員工對 bot 送出即自動註冊。
        <br />
        ② <span className="font-medium text-foreground">手動新增</span>
        :請員工先隨便傳一句話給 bot,bot 會回覆他的 ID,再到這裡新增。
        <br />
        權限:管理者=全功能;員工=僅查詢(訂單/工單/產品/行事曆),不含銷售/成本統計、請假審核與交辦。
      </div>

      {/* 使用者清單 */}
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-foreground">
            已授權帳號
            <span className="ml-2 rounded-full bg-foreground/10 px-2 py-0.5 text-xs tabular-nums">
              {users.length}
            </span>
          </h3>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-8 gap-1.5 text-xs"
              onClick={() => void load()}
              disabled={loading}
            >
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
              重新整理
            </Button>
            <Button
              type="button"
              className="h-8 gap-1.5 text-xs"
              onClick={() => setShowAddForm((v) => !v)}
            >
              <UserPlus className="h-3.5 w-3.5" />
              手動新增
            </Button>
          </div>
        </div>

        {showAddForm && (
          <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4 shadow-sm">
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              chat_id
              <input
                value={addChatId}
                onChange={(e) => setAddChatId(e.target.value)}
                placeholder="例:123456789"
                className={cn(inputCls, "w-40")}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              顯示名稱
              <input
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                placeholder="例:柏璁"
                className={cn(inputCls, "w-32")}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              角色
              <select
                value={addRole}
                onChange={(e) => setAddRole(e.target.value as BotRole)}
                className={inputCls}
              >
                <option value="staff">員工</option>
                <option value="admin">管理者</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              綁定員工(選填)
              {employeeSelect(addEmployeeId, setAddEmployeeId)}
            </label>
            <Button
              type="button"
              className="h-9 gap-1.5 text-xs"
              onClick={() => void addUser()}
              disabled={actingId === "add"}
            >
              <Plus className="h-3.5 w-3.5" />
              新增
            </Button>
          </div>
        )}

        <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
          {loading ? (
            <p className="py-10 text-center text-sm text-muted-foreground">載入中…</p>
          ) : users.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              尚無授權帳號。管理員本人首次傳訊息給 bot 後會自動出現在這裡。
            </p>
          ) : (
            <>
              {/* 手機／平板（lg 以下）：卡片清單 */}
              <div className="grid grid-cols-1 items-start gap-2 p-3 md:grid-cols-2 lg:hidden">
                {users.map((row) => (
                  <div key={row.chat_id} className="flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-card p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="break-words text-sm font-medium text-foreground">
                          {row.name}
                          {row.note ? <span className="ml-2 text-[11px] font-normal text-muted-foreground">{row.note}</span> : null}
                        </p>
                        <p className="break-all font-mono text-[11px] text-muted-foreground">{row.chat_id}</p>
                      </div>
                      <div className="shrink-0">{renderUserActiveToggle(row)}</div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="flex min-w-0 flex-col gap-0.5 text-[11px] text-muted-foreground">
                        角色
                        {renderUserRoleSelect(row)}
                      </label>
                      <label className="flex min-w-0 flex-col gap-0.5 text-[11px] text-muted-foreground">
                        綁定員工
                        {renderUserEmployeeSelect(row, "w-full")}
                      </label>
                    </div>
                    <div className="flex items-center justify-between gap-2 border-t border-border/60 pt-1.5">
                      <span className="text-[11px] tabular-nums text-muted-foreground">加入 {formatDateTime(row.created_at)}</span>
                      {renderUserDelete(row)}
                    </div>
                  </div>
                ))}
              </div>

              {/* 電腦（lg 以上）：表格 */}
              <div className="hidden lg:block">
                <Table className="min-w-[46rem]">
                  <TableHeader>
                    <TableRow className="hover:bg-transparent border-b border-border bg-muted/30">
                      <TableHead className="text-xs font-semibold">名稱</TableHead>
                      <TableHead className="text-xs font-semibold">chat_id</TableHead>
                      <TableHead className="text-xs font-semibold">角色</TableHead>
                      <TableHead className="text-xs font-semibold">綁定員工</TableHead>
                      <TableHead className="text-xs font-semibold">狀態</TableHead>
                      <TableHead className="text-xs font-semibold whitespace-nowrap">加入時間</TableHead>
                      <TableHead className="text-xs font-semibold">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users.map((row) => (
                      <TableRow key={row.chat_id} className="border-b border-border hover:bg-muted/25">
                        <TableCell className="font-medium text-foreground">
                          {row.name}
                          {row.note ? (
                            <span className="ml-2 text-[11px] text-muted-foreground">{row.note}</span>
                          ) : null}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {row.chat_id}
                        </TableCell>
                        <TableCell>{renderUserRoleSelect(row)}</TableCell>
                        <TableCell>{renderUserEmployeeSelect(row, "max-w-[10rem]")}</TableCell>
                        <TableCell>{renderUserActiveToggle(row)}</TableCell>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                          {formatDateTime(row.created_at)}
                        </TableCell>
                        <TableCell>{renderUserDelete(row)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </div>
      </section>

      {/* 邀請碼 */}
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-foreground">邀請碼</h3>
          <Button
            type="button"
            className="h-8 gap-1.5 text-xs"
            onClick={() => setShowInviteForm((v) => !v)}
          >
            <Ticket className="h-3.5 w-3.5" />
            產生邀請碼
          </Button>
        </div>

        {showInviteForm && (
          <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4 shadow-sm">
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              角色
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as BotRole)}
                className={inputCls}
              >
                <option value="staff">員工</option>
                <option value="admin">管理者</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              顯示名稱(選填,留空用 Telegram 名字)
              <input
                value={inviteName}
                onChange={(e) => setInviteName(e.target.value)}
                placeholder="例:柏璁"
                className={cn(inputCls, "w-40")}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              綁定員工(選填)
              {employeeSelect(inviteEmployeeId, setInviteEmployeeId)}
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              有效天數
              <NumericInput
                min={1}
                max={90}
                value={inviteDays}
                onValueChange={(v) => setInviteDays(Math.max(1, v ?? 1))}
                className={cn(inputCls, "w-20")}
              />
            </label>
            <Button
              type="button"
              className="h-9 gap-1.5 text-xs"
              onClick={() => void createInvite()}
              disabled={actingId === "invite"}
            >
              <Plus className="h-3.5 w-3.5" />
              產生
            </Button>
          </div>
        )}

        <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
          {loading ? (
            <p className="py-10 text-center text-sm text-muted-foreground">載入中…</p>
          ) : invites.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              尚無邀請碼。產生後把「/start 邀請碼」傳給員工即可。
            </p>
          ) : (
            <>
              {/* 手機／平板（lg 以下）：卡片清單 */}
              <div className="grid grid-cols-1 items-start gap-2 p-3 md:grid-cols-2 lg:hidden">
                {invites.map((row) => {
                  const status = inviteStatus(row);
                  return (
                    <div key={row.id} className="flex min-w-0 flex-col gap-1.5 rounded-lg border border-border bg-card p-3">
                      <div className="flex items-start justify-between gap-2">
                        <p className="min-w-0 break-all font-mono text-sm font-medium text-foreground">{row.code}</p>
                        <span className="shrink-0 text-xs">{renderInviteStatus(row, status)}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {roleLabel(row.role)}・{inviteTargetName(row)}
                      </p>
                      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-1.5">
                        <span className="text-[11px] tabular-nums text-muted-foreground">
                          有效至 {formatDateTime(row.expires_at)}
                        </span>
                        {renderInviteActions(row, status)}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* 電腦（lg 以上）：表格 */}
              <div className="hidden lg:block">
                <Table className="min-w-[42rem]">
                  <TableHeader>
                    <TableRow className="hover:bg-transparent border-b border-border bg-muted/30">
                      <TableHead className="text-xs font-semibold">邀請碼</TableHead>
                      <TableHead className="text-xs font-semibold">角色</TableHead>
                      <TableHead className="text-xs font-semibold">預設名稱/員工</TableHead>
                      <TableHead className="text-xs font-semibold">狀態</TableHead>
                      <TableHead className="text-xs font-semibold whitespace-nowrap">有效期限</TableHead>
                      <TableHead className="text-xs font-semibold">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invites.map((row) => {
                      const status = inviteStatus(row);
                      return (
                        <TableRow key={row.id} className="border-b border-border hover:bg-muted/25">
                          <TableCell className="font-mono text-sm font-medium text-foreground">
                            {row.code}
                          </TableCell>
                          <TableCell className="text-sm">{roleLabel(row.role)}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{inviteTargetName(row)}</TableCell>
                          <TableCell className="text-sm">{renderInviteStatus(row, status)}</TableCell>
                          <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                            {formatDateTime(row.expires_at)}
                          </TableCell>
                          <TableCell>{renderInviteActions(row, status)}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
