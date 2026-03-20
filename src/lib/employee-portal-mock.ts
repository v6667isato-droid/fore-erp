/**
 * 員工儀表板 — Mock 資料與型別。
 * 未來接上 Supabase 時：在此檔或專用 API route 以相同 shape 回傳，
 * 並將 page 內的 load 改為 await supabase.from('employees')... 等查詢。
 */

export type TaskStatus = "todo" | "in_progress" | "done";

export interface EmployeePortalEmployee {
  id: string;
  full_name: string;
  base_salary: number;
}

export interface AnnouncementRow {
  id: string;
  title: string;
  body: string;
  published_at: string;
  is_active: boolean;
}

export interface EmployeeTaskRow {
  id: string;
  title: string;
  status: TaskStatus;
  due_date: string | null;
}

export type LeaveRequestStatus = "pending" | "approved" | "rejected";

export interface LeaveRequestRow {
  id: string;
  type_label: string;
  start_date: string;
  end_date: string;
  status: LeaveRequestStatus;
  /** 已核准且為扣薪假時，計入本月扣薪天數 */
  deducts_salary: boolean;
  days_count: number;
}

export interface MachineAuthRow {
  machine_id: string;
  machine_name: string;
  authorized: boolean;
}

export interface EmployeePortalPayload {
  employee: EmployeePortalEmployee;
  /** 本月已核准、且 deducts_salary 之請假天數加總（Mock 可直接給數字） */
  monthly_salary_deduct_days: number;
  announcements: AnnouncementRow[];
  tasks: EmployeeTaskRow[];
  leave_requests: LeaveRequestRow[];
  machine_authorizations: MachineAuthRow[];
}

/** 本月預估發放：底薪 − (底薪／30 × 扣薪請假天數) */
export function estimateMonthlyPayout(
  baseSalary: number,
  salaryDeductLeaveDays: number
): number {
  const perDay = baseSalary / 30;
  return Math.max(0, Math.round(baseSalary - perDay * salaryDeductLeaveDays));
}

export const employeePortalMock: EmployeePortalPayload = {
  employee: {
    id: "emp-mock-001",
    full_name: "林雅婷",
    base_salary: 42000,
  },
  monthly_salary_deduct_days: 1.5,
  announcements: [
    {
      id: "ann-1",
      title: "春節工廠休假日程公告",
      body: "農曆除夕至初三全廠休息，急單請於假前兩週完成報工與出貨協調。",
      published_at: "2026-03-18",
      is_active: true,
    },
    {
      id: "ann-2",
      title: "木料倉儲區動線調整",
      body: "本週起 A 區改為「待乾燥材」專用，進出請配戴識別證並遵守堆高機禮讓。",
      published_at: "2026-03-15",
      is_active: true,
    },
    {
      id: "ann-3",
      title: "舊版已停用",
      body: "此則不應顯示（is_active=false 時由查詢過濾）。",
      published_at: "2026-01-01",
      is_active: false,
    },
  ],
  tasks: [
    {
      id: "t1",
      title: "完成餐桌系列 B 品檢照片補拍",
      status: "in_progress",
      due_date: "2026-03-22",
    },
    {
      id: "t2",
      title: "更新 CNC 程式備份至共用碟",
      status: "todo",
      due_date: "2026-03-25",
    },
    {
      id: "t3",
      title: "新人安全教育簽到表繳回",
      status: "todo",
      due_date: null,
    },
  ],
  leave_requests: [
    {
      id: "lr1",
      type_label: "特休",
      start_date: "2026-03-28",
      end_date: "2026-03-28",
      status: "pending",
      deducts_salary: false,
      days_count: 1,
    },
    {
      id: "lr2",
      type_label: "病假",
      start_date: "2026-03-10",
      end_date: "2026-03-11",
      status: "approved",
      deducts_salary: true,
      days_count: 1.5,
    },
    {
      id: "lr3",
      type_label: "事假",
      start_date: "2026-02-20",
      end_date: "2026-02-20",
      status: "rejected",
      deducts_salary: true,
      days_count: 1,
    },
  ],
  machine_authorizations: [
    { machine_id: "m1", machine_name: "CNC 雕刻機 A", authorized: true },
    { machine_id: "m2", machine_name: "帶鋸機（主線）", authorized: true },
    { machine_id: "m3", machine_name: "立式鉋木機", authorized: false },
    { machine_id: "m4", machine_name: "集塵中央系統操作", authorized: false },
  ],
};

/**
 * 預留：改為 Supabase 查詢後組裝為 EmployeePortalPayload。
 * 範例（偽碼）：
 * const { data: emp } = await supabase.from('employees').select('id, full_name, base_salary').eq('id', employeeId).single();
 * const { data: leaves } = await supabase.from('leave_requests').select('*').eq('employee_id', employeeId).eq('status','approved')...
 * const deductDays = sumDeductDaysForCurrentMonth(leaves);
 */
export async function fetchEmployeePortalData(): Promise<EmployeePortalPayload> {
  await new Promise((r) => setTimeout(r, 120));
  return employeePortalMock;
}

export function activeAnnouncements(rows: AnnouncementRow[]): AnnouncementRow[] {
  return rows.filter((a) => a.is_active).sort((a, b) => (a.published_at < b.published_at ? 1 : -1));
}
