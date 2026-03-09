"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import { ClipboardList, Eye, Pencil, Trash2, X } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { cn, formatDate } from "@/lib/utils";
import { toast } from "sonner";

type Role = "admin" | "staff" | null;

interface EmployeeRow {
  id: string;
  name: string;
  email: string | null;
  primary_role: string | null;
  secondary_role: string | null;
  phone: string | null;
  emergency_contact: string | null;
  // UI 上仍叫「到職日」，實際資料庫欄位為 hire_date
  start_date: string | null;
  /** UI 端顯示用（在職 / 離職 / 留停），實際資料庫欄位為 boolean */
  employment_status: string | null;
  monthly_wage: number | null;
  labor_insured_salary: number | null;
  labor_self: number | null;
  labor_employer: number | null;
  pension_employer: number | null;
  health_self: number | null;
  health_employer: number | null;
}

// 對應資料庫 employees 表實際欄位
const EMP_SELECT_ADMIN =
  "id, name, email, primary_role, secondary_role, phone, emergency_contact, hire_date, employment_status, monthly_wage, labor_insurance_bracket, labor_employee_burden, labor_employer_burden, labor_pension_employer, health_employee_burden, health_employer_burden";

const EMP_SELECT_STAFF =
  "id, name, email, primary_role, secondary_role, phone, emergency_contact, hire_date, employment_status";

function mapEmployee(r: Record<string, unknown>): EmployeeRow {
  const rawStatus = (r as Record<string, unknown>).employment_status;
  let status: string | null = null;
  if (typeof rawStatus === "boolean") {
    status = rawStatus ? "在職" : "離職";
  } else if (rawStatus != null) {
    status = String(rawStatus);
  }

  return {
    id: String(r.id),
    name: String(r.name ?? ""),
    email: r.email != null ? String(r.email) : null,
    primary_role: r.primary_role != null ? String(r.primary_role) : null,
    secondary_role: r.secondary_role != null ? String(r.secondary_role) : null,
    phone: r.phone != null ? String(r.phone) : null,
    emergency_contact:
      r.emergency_contact != null ? String(r.emergency_contact) : null,
    // 資料庫欄位名稱為 hire_date
    start_date: (r as Record<string, unknown>).hire_date != null ? String((r as Record<string, unknown>).hire_date) : null,
    employment_status: status,
    monthly_wage:
      (r as Record<string, unknown>).monthly_wage != null
        ? Number((r as Record<string, unknown>).monthly_wage as number)
        : null,
    labor_insured_salary:
      (r as Record<string, unknown>).labor_insurance_bracket != null
        ? Number((r as Record<string, unknown>).labor_insurance_bracket as number)
        : null,
    labor_self:
      (r as Record<string, unknown>).labor_employee_burden != null
        ? Number((r as Record<string, unknown>).labor_employee_burden as number)
        : null,
    labor_employer:
      (r as Record<string, unknown>).labor_employer_burden != null
        ? Number((r as Record<string, unknown>).labor_employer_burden as number)
        : null,
    pension_employer:
      (r as Record<string, unknown>).labor_pension_employer != null
        ? Number((r as Record<string, unknown>).labor_pension_employer as number)
        : null,
    health_self:
      (r as Record<string, unknown>).health_employee_burden != null
        ? Number((r as Record<string, unknown>).health_employee_burden as number)
        : null,
    health_employer:
      (r as Record<string, unknown>).health_employer_burden != null
        ? Number((r as Record<string, unknown>).health_employer_burden as number)
        : null,
  };
}

function useCurrentUserRole() {
  const [role, setRole] = useState<Role>(null);
  const [name, setName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const {
          data: { user },
          error,
        } = await supabase.auth.getUser();
        // 若尚未登入，暫時以 staff 權限顯示（僅基本欄位）
        if (error || !user) {
          if (!cancelled) {
            setRole("staff");
            setName(null);
            setLoading(false);
          }
          return;
        }
        // 先假設 user_profiles 以 user_id 連到 auth.users.id，如無此欄位再退回用 id 查
        let { data: profile, error: pErr } = await supabase
          .from("user_profiles")
          .select("full_name, role")
          .eq("user_id", user.id)
          .single();

        if (pErr) {
          const byId = await supabase
            .from("user_profiles")
            .select("full_name, role")
            .eq("id", user.id)
            .single();
          profile = byId.data;
          pErr = byId.error;
        }

        if (!cancelled) {
          if (!pErr && profile) {
            const raw = ((profile.role as string) ?? "").trim().toLowerCase();
            // 只要不是明確標示為 staff，其餘有值的角色一律視為 admin
            const appRole: Role =
              raw === "staff" || raw === ""
                ? "staff"
                : "admin";
            console.log("user_profiles.role =", profile.role, "mapped to", appRole);
            setRole(appRole);
            setName((profile.full_name as string) ?? user.email ?? "User");
          } else {
            setRole("staff");
            setName(user.email ?? "User");
          }
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setRole(null);
          setName(null);
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { role, name, loading };
}

type TabKey = "basic" | "salary";

interface EmployeeFormProps {
  initial: Partial<EmployeeRow>;
  isAdmin: boolean;
  mode: "create" | "edit";
  // payload 直接對應資料庫欄位（如 hire_date、labor_insurance_bracket...）
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
}

function EmployeeForm({
  initial,
  isAdmin,
  mode,
  onSubmit,
  onCancel,
}: EmployeeFormProps) {
  const [tab, setTab] = useState<TabKey>("basic");
  const [values, setValues] = useState<Partial<EmployeeRow>>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setValues(initial);
    setError(null);
    setTab("basic");
  }, [initial, mode]);

  useEffect(() => {
    if (firstRef.current) {
      setTimeout(() => firstRef.current?.focus(), 0);
    }
  }, [tab]);

  function setField<K extends keyof EmployeeRow>(key: K, val: EmployeeRow[K]) {
    setValues((prev) => ({ ...prev, [key]: val }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!values.name?.trim()) {
      setError("請輸入姓名");
      return;
    }
    setSaving(true);
    try {
      // employment_status 轉成 boolean 存進資料庫（在職=true、離職=false、其他/null）
      let employmentBool: boolean | null = null;
      if (values.employment_status === "在職") employmentBool = true;
      else if (values.employment_status === "離職") employmentBool = false;
      else employmentBool = null;

      const payload: Record<string, unknown> = {
        name: values.name.trim(),
        email: values.email?.trim() || null,
        primary_role: values.primary_role?.trim() || null,
        secondary_role: values.secondary_role?.trim() || null,
        phone: values.phone?.trim() || null,
        emergency_contact: values.emergency_contact?.trim() || null,
        hire_date: values.start_date || null,
        employment_status: employmentBool,
      };
      if (isAdmin) {
        payload.monthly_wage =
          values.monthly_wage != null ? Number(values.monthly_wage) : null;
        payload.labor_insurance_bracket =
          values.labor_insured_salary != null
            ? Number(values.labor_insured_salary)
            : null;
        payload.labor_employee_burden =
          values.labor_self != null ? Number(values.labor_self) : null;
        payload.labor_employer_burden =
          values.labor_employer != null
            ? Number(values.labor_employer)
            : null;
        payload.labor_pension_employer =
          values.pension_employer != null
            ? Number(values.pension_employer)
            : null;
        payload.health_employee_burden =
          values.health_self != null ? Number(values.health_self) : null;
        payload.health_employer_burden =
          values.health_employer != null
            ? Number(values.health_employer)
            : null;
      }
      await onSubmit(payload);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-4 flex flex-1 flex-col overflow-hidden"
    >
      <div className="flex border-b border-border bg-muted/20 px-5">
        <button
          type="button"
          onClick={() => setTab("basic")}
          className={cn(
            "flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors",
            tab === "basic"
              ? "border-b-2 border-primary bg-card text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          基本資料
        </button>
        {isAdmin && (
          <button
            type="button"
            onClick={() => setTab("salary")}
            className={cn(
              "flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors",
              tab === "salary"
                ? "border-b-2 border-primary bg-card text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            薪資與保險
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {tab === "basic" && (
          <>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="emp-name" className="text-xs text-muted-foreground">
                姓名 *
              </label>
              <input
                ref={firstRef}
                id="emp-name"
                type="text"
                value={values.name ?? ""}
                onChange={(e) => setField("name", e.target.value)}
                className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="emp-email"
                className="text-xs text-muted-foreground"
              >
                信箱
              </label>
              <input
                id="emp-email"
                type="email"
                value={values.email ?? ""}
                onChange={(e) => setField("email", e.target.value)}
                className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="emp-primary-role"
                  className="text-xs text-muted-foreground"
                >
                  主要角色
                </label>
                <input
                  id="emp-primary-role"
                  type="text"
                  value={values.primary_role ?? ""}
                  onChange={(e) => setField("primary_role", e.target.value)}
                  className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="emp-secondary-role"
                  className="text-xs text-muted-foreground"
                >
                  次要角色
                </label>
                <input
                  id="emp-secondary-role"
                  type="text"
                  value={values.secondary_role ?? ""}
                  onChange={(e) => setField("secondary_role", e.target.value)}
                  className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="emp-phone"
                  className="text-xs text-muted-foreground"
                >
                  手機
                </label>
                <input
                  id="emp-phone"
                  type="tel"
                  value={values.phone ?? ""}
                  onChange={(e) => setField("phone", e.target.value)}
                  className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="emp-emergency"
                  className="text-xs text-muted-foreground"
                >
                  緊急聯絡人
                </label>
                <input
                  id="emp-emergency"
                  type="text"
                  value={values.emergency_contact ?? ""}
                  onChange={(e) =>
                    setField("emergency_contact", e.target.value)
                  }
                  className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="emp-start"
                  className="text-xs text-muted-foreground"
                >
                  到職日
                </label>
                <input
                  id="emp-start"
                  type="date"
                  value={values.start_date ?? ""}
                  onChange={(e) => setField("start_date", e.target.value)}
                  className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="emp-status"
                  className="text-xs text-muted-foreground"
                >
                  在職狀態
                </label>
                <select
                  id="emp-status"
                  value={values.employment_status ?? "在職"}
                  onChange={(e) =>
                    setField("employment_status", e.target.value)
                  }
                  className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="在職">在職</option>
                  <option value="離職">離職</option>
                  <option value="留停">留停</option>
                </select>
              </div>
            </div>
          </>
        )}

        {tab === "salary" && isAdmin && (
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="emp-monthly"
                className="text-xs text-muted-foreground"
              >
                月薪 (monthly_wage)
              </label>
              <input
                id="emp-monthly"
                type="number"
                value={values.monthly_wage ?? ""}
                onChange={(e) =>
                  setField("monthly_wage", Number(e.target.value) || 0)
                }
                className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="emp-labor-salary"
                className="text-xs text-muted-foreground"
              >
                勞保投保薪資
              </label>
              <input
                id="emp-labor-salary"
                type="number"
                value={values.labor_insured_salary ?? ""}
                onChange={(e) =>
                  setField(
                    "labor_insured_salary",
                    Number(e.target.value) || 0,
                  )
                }
                className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="emp-labor-self"
                className="text-xs text-muted-foreground"
              >
                勞保自付額
              </label>
              <input
                id="emp-labor-self"
                type="number"
                value={values.labor_self ?? ""}
                onChange={(e) =>
                  setField("labor_self", Number(e.target.value) || 0)
                }
                className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="emp-labor-employer"
                className="text-xs text-muted-foreground"
              >
                勞保雇主負擔
              </label>
              <input
                id="emp-labor-employer"
                type="number"
                value={values.labor_employer ?? ""}
                onChange={(e) =>
                  setField("labor_employer", Number(e.target.value) || 0)
                }
                className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="emp-pension"
                className="text-xs text-muted-foreground"
              >
                勞退雇主負擔
              </label>
              <input
                id="emp-pension"
                type="number"
                value={values.pension_employer ?? ""}
                onChange={(e) =>
                  setField("pension_employer", Number(e.target.value) || 0)
                }
                className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="emp-health-self"
                className="text-xs text-muted-foreground"
              >
                健保自付額
              </label>
              <input
                id="emp-health-self"
                type="number"
                value={values.health_self ?? ""}
                onChange={(e) =>
                  setField("health_self", Number(e.target.value) || 0)
                }
                className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="emp-health-employer"
                className="text-xs text-muted-foreground"
              >
                健保雇主負擔
              </label>
              <input
                id="emp-health-employer"
                type="number"
                value={values.health_employer ?? ""}
                onChange={(e) =>
                  setField("health_employer", Number(e.target.value) || 0)
                }
                className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>
        )}

        {error && (
          <p className="text-xs text-destructive" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="flex justify-end gap-2 border-t border-border p-5 pt-4">
        <Button type="button" variant="ghost" disabled={saving} onClick={onCancel}>
          取消
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? "儲存中…" : "儲存"}
        </Button>
      </div>
    </form>
  );
}

interface AddEmployeeDialogProps {
  onSuccess: () => void;
  isAdmin: boolean;
}

function AddEmployeeDialog({ onSuccess, isAdmin }: AddEmployeeDialogProps) {
  const [open, setOpen] = useState(false);

  async function handleSubmit(payload: Record<string, unknown>) {
    const { error } = await supabase.from("employees").insert(payload);
    if (error) {
      toast.error(error.message || "新增員工失敗");
      return;
    }
    toast.success("已新增員工");
    setOpen(false);
    onSuccess();
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-input bg-background px-4 text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
        >
          <ClipboardList className="h-4 w-4" />
          新增員工
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border border-border bg-card shadow-lg focus:outline-none flex flex-col"
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <div className="flex items-start justify-between gap-4 border-b border-border p-5 pb-0">
            <div>
              <Dialog.Title className="text-base font-semibold text-foreground">
                新增員工
              </Dialog.Title>
              <p className="mt-1 text-sm text-muted-foreground">
                建立一筆員工資料
              </p>
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
          <EmployeeForm
            initial={{ employment_status: "在職" }}
            isAdmin={isAdmin}
            mode="create"
            onSubmit={handleSubmit}
            onCancel={() => setOpen(false)}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

interface EditEmployeeDialogProps {
  row: EmployeeRow | null;
  isAdmin: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

function EditEmployeeDialog({
  row,
  isAdmin,
  onClose,
  onSuccess,
}: EditEmployeeDialogProps) {
  const open = row != null;

  async function handleSubmit(payload: Record<string, unknown>) {
    if (!row) return;
    const { error } = await supabase
      .from("employees")
      .update(payload)
      .eq("id", row.id);
    if (error) {
      toast.error(error.message || "更新員工失敗");
      return;
    }
    toast.success("已更新員工");
    onSuccess();
    onClose();
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border border-border bg-card shadow-lg focus:outline-none flex flex-col"
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <div className="flex items-start justify-between gap-4 border-b border-border p-5 pb-0">
            <div>
              <Dialog.Title className="text-base font-semibold text-foreground">
                編輯員工
              </Dialog.Title>
              <p className="mt-1 text-sm text-muted-foreground">
                修改員工資料
              </p>
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
          {row && (
            <EmployeeForm
              initial={row}
              isAdmin={isAdmin}
              mode="edit"
              onSubmit={handleSubmit}
              onCancel={onClose}
            />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

interface ViewEmployeeDialogProps {
  row: EmployeeRow | null;
  isAdmin: boolean;
  onClose: () => void;
}

function ViewEmployeeDialog({ row, isAdmin, onClose }: ViewEmployeeDialogProps) {
  const open = row != null;

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-lg focus:outline-none"
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          {row && (
            <>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <Dialog.Title className="text-base font-semibold text-foreground">
                    員工總覽 — {row.name || "未命名"}
                  </Dialog.Title>
                  <p className="mt-1 text-sm text-muted-foreground">
                    檢視員工的基本資料與聯絡方式
                  </p>
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

              <div className="mt-4 space-y-5">
                <section className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    基本資料
                  </h3>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">姓名</span>
                      <span className="font-medium text-foreground">
                        {row.name || "—"}
                      </span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">主要角色</span>
                      <span className="text-foreground">
                        {row.primary_role ?? "—"}
                      </span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">次要角色</span>
                      <span className="text-foreground">
                        {row.secondary_role ?? "—"}
                      </span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">在職狀態</span>
                      <span className="text-foreground">
                        {row.employment_status ?? "—"}
                      </span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">到職日</span>
                      <span className="text-foreground">
                        {row.start_date ? formatDate(row.start_date) : "—"}
                      </span>
                    </div>
                  </div>
                </section>

                <section className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    聯絡方式
                  </h3>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">信箱</span>
                      <span className="text-foreground break-all">
                        {row.email ?? "—"}
                      </span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">手機</span>
                      <span className="text-foreground">
                        {row.phone ?? "—"}
                      </span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">
                        緊急聯絡人與電話
                      </span>
                      <span className="text-foreground">
                        {row.emergency_contact ?? "—"}
                      </span>
                    </div>
                  </div>
                </section>

                {isAdmin && (
                  <section className="space-y-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      薪資與保險（僅 Admin 可見）
                    </h3>
                    <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
                      <div className="flex justify-between gap-4">
                        <span className="text-muted-foreground">月薪</span>
                        <span className="text-foreground tabular-nums">
                          {row.monthly_wage != null
                            ? row.monthly_wage.toLocaleString()
                            : "—"}
                        </span>
                      </div>
                      <div className="flex justify-between gap-4">
                        <span className="text-muted-foreground">
                          勞保投保薪資
                        </span>
                        <span className="text-foreground tabular-nums">
                          {row.labor_insured_salary != null
                            ? row.labor_insured_salary.toLocaleString()
                            : "—"}
                        </span>
                      </div>
                      <div className="flex justify-between gap-4">
                        <span className="text-muted-foreground">
                          勞保自付額
                        </span>
                        <span className="text-foreground tabular-nums">
                          {row.labor_self != null
                            ? row.labor_self.toLocaleString()
                            : "—"}
                        </span>
                      </div>
                      <div className="flex justify-between gap-4">
                        <span className="text-muted-foreground">
                          勞保雇主負擔
                        </span>
                        <span className="text-foreground tabular-nums">
                          {row.labor_employer != null
                            ? row.labor_employer.toLocaleString()
                            : "—"}
                        </span>
                      </div>
                      <div className="flex justify-between gap-4">
                        <span className="text-muted-foreground">
                          勞退雇主負擔
                        </span>
                        <span className="text-foreground tabular-nums">
                          {row.pension_employer != null
                            ? row.pension_employer.toLocaleString()
                            : "—"}
                        </span>
                      </div>
                      <div className="flex justify-between gap-4">
                        <span className="text-muted-foreground">
                          健保自付額
                        </span>
                        <span className="text-foreground tabular-nums">
                          {row.health_self != null
                            ? row.health_self.toLocaleString()
                            : "—"}
                        </span>
                      </div>
                      <div className="flex justify-between gap-4">
                        <span className="text-muted-foreground">
                          健保雇主負擔
                        </span>
                        <span className="text-foreground tabular-nums">
                          {row.health_employer != null
                            ? row.health_employer.toLocaleString()
                            : "—"}
                        </span>
                      </div>
                    </div>
                  </section>
                )}
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function EmployeesPage() {
  const { role, name: currentUserName, loading: authLoading } =
    useCurrentUserRole();
  const isAdmin = role === "admin";

  const [rows, setRows] = useState<EmployeeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState("");
  const [editRow, setEditRow] = useState<EmployeeRow | null>(null);
  const [viewRow, setViewRow] = useState<EmployeeRow | null>(null);

  async function fetchEmployees(currentRole: Role) {
    if (!currentRole) return;
    setLoading(true);
    const select = currentRole === "admin" ? EMP_SELECT_ADMIN : EMP_SELECT_STAFF;
    let { data, error } = await supabase
      .from("employees")
      .select(select)
      .order("hire_date", { ascending: false });

    if (error) {
      console.error("employees fetch error:", error.message, error);
      toast.error(error.message || "員工資料讀取失敗");
      setRows([]);
      setLoading(false);
      return;
    }
    setRows(((data ?? []) as Record<string, unknown>[]).map(mapEmployee));
    setLoading(false);
  }

  useEffect(() => {
    if (!authLoading && role) {
      fetchEmployees(role);
    }
  }, [authLoading, role]);

  const filtered = useMemo(() => {
    let list = rows;
    if (filterStatus)
      list = list.filter((r) => r.employment_status === filterStatus);
    return list;
  }, [rows, filterStatus]);

  async function handleDelete(row: EmployeeRow) {
    if (
      !confirm(
        `確定要刪除員工「${row.name || "未命名"}」？此操作無法復原。`,
      )
    )
      return;
    const { error } = await supabase.from("employees").delete().eq("id", row.id);
    if (error) {
      toast.error(error.message || "刪除失敗");
      return;
    }
    toast.success("已刪除員工");
    fetchEmployees(role);
    setEditRow(null);
    setViewRow(null);
  }

  if (authLoading || loading) {
    return (
      <div className="flex flex-col gap-4">
        <div className="rounded-xl border border-border bg-card px-5 py-4">
          <div className="flex items-center gap-4">
            <div className="h-10 w-10 animate-pulse rounded-lg bg-muted" />
            <div className="space-y-2">
              <div className="h-3 w-24 animate-pulse rounded bg-muted" />
              <div className="h-6 w-16 animate-pulse rounded bg-muted" />
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-8 text-center text-muted-foreground">
          載入員工資料中…
        </div>
      </div>
    );
  }

  if (!role) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 text-center text-muted-foreground">
        無法取得目前登入者的權限，請重新登入。
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-4 rounded-xl border border-border bg-card px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary"
            aria-hidden
          >
            <ClipboardList className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
              員工總數
            </p>
            <p className="text-xl font-semibold text-foreground">
              {rows.length}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              目前登入：{currentUserName ?? "—"}（{role}）
            </p>
          </div>
        </div>
        <AddEmployeeDialog onSuccess={() => fetchEmployees(role)} isAdmin={isAdmin} />
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-border bg-muted/20 px-4 py-3">
          <span className="text-xs font-medium text-muted-foreground shrink-0">
            篩選
          </span>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="h-8 min-w-[7rem] rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label="依在職狀態篩選"
          >
            <option value="">在職狀態：全部</option>
            <option value="在職">在職</option>
            <option value="離職">離職</option>
            <option value="留停">留停</option>
          </select>
          {filterStatus && (
            <button
              type="button"
              onClick={() => setFilterStatus("")}
              className="text-xs text-muted-foreground hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring rounded px-2 py-1"
            >
              清除篩選
            </button>
          )}
          <span className="text-xs text-muted-foreground ml-auto">
            共 {filtered.length} 筆{filterStatus ? "（已篩選）" : ""}
          </span>
        </div>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent border-b border-border">
              <TableHead className="text-xs font-semibold p-2 align-middle">
                姓名
              </TableHead>
              <TableHead className="text-xs font-semibold p-2 align-middle">
                主要角色
              </TableHead>
              <TableHead className="text-xs font-semibold p-2 align-middle">
                次要角色
              </TableHead>
              <TableHead className="text-xs font-semibold p-2 align-middle">
                信箱
              </TableHead>
              <TableHead className="text-xs font-semibold p-2 align-middle">
                手機
              </TableHead>
              <TableHead className="text-xs font-semibold p-2 align-middle">
                到職日
              </TableHead>
              <TableHead className="text-xs font-semibold p-2 align-middle">
                在職狀態
              </TableHead>
              {isAdmin && (
                <TableHead className="text-xs font-semibold p-2 align-middle text-right">
                  月薪
                </TableHead>
              )}
              <TableHead className="text-xs font-semibold p-2 align-middle min-w-[140px]" aria-label="操作">
                操作
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={isAdmin ? 9 : 8}
                  className="h-24 text-center text-muted-foreground"
                >
                  {rows.length === 0
                    ? "尚無員工資料，請點「新增員工」建立第一筆。"
                    : "無符合篩選條件的員工。"}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((row) => (
                <TableRow
                  key={row.id}
                  className="border-b border-border hover:bg-muted/30"
                >
                  <TableCell className="text-sm font-medium p-2">
                    <button
                      type="button"
                      onClick={() => setViewRow(row)}
                      className="text-left text-primary hover:underline focus:outline-none focus:ring-2 focus:ring-ring rounded"
                    >
                      {row.name || "—"}
                    </button>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground p-2">
                    {row.primary_role ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground p-2">
                    {row.secondary_role ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground p-2">
                    {row.email ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground p-2">
                    {row.phone ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground p-2 whitespace-nowrap">
                    {row.start_date ? formatDate(row.start_date) : "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground p-2">
                    {row.employment_status ?? "—"}
                  </TableCell>
                  {isAdmin && (
                    <TableCell className="text-sm text-right p-2 tabular-nums">
                      {row.monthly_wage != null
                        ? row.monthly_wage.toLocaleString()
                        : "—"}
                    </TableCell>
                  )}
                  <TableCell className="p-2">
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => setViewRow(row)}
                        aria-label={`總覽 ${row.name}`}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => setEditRow(row)}
                        aria-label={`編輯 ${row.name}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => handleDelete(row)}
                        aria-label={`刪除 ${row.name}`}
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

      <EditEmployeeDialog
        row={editRow}
        isAdmin={isAdmin}
        onClose={() => setEditRow(null)}
        onSuccess={() => fetchEmployees(role)}
      />
      <ViewEmployeeDialog
        row={viewRow}
        isAdmin={isAdmin}
        onClose={() => setViewRow(null)}
      />
    </div>
  );
}

