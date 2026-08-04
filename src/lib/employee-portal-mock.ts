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
  /** 特休剩餘天數（可小數）；對應 employees.annual_leave_remaining */
  annual_leave_remaining?: number | null;
  /** 補休剩餘總時數；對應 employees.comp_leave_remaining（8 小時 = 1 日） */
  comp_leave_remaining?: number | null;
  /** 到職日（YYYY-MM-DD）；對應 employees.hire_date，用於年資顯示 */
  hire_date?: string | null;
  /** 留職停薪月份（YYYY-MM）；對應 employees.unpaid_leave_months，年資計算時逐月扣除 */
  unpaid_leave_months?: string[] | null;
}

/** 頂部三格統計（本月薪資為固定顯示用數字，可與薪資試算分開） */
export interface EmployeePortalStats {
  /** 本月薪資（固定顯示，NT$） */
  monthly_salary_ntd: number;
  /** 本月加班天數 */
  monthly_overtime_days: number;
  /** 本月請假天數（曆日或申請天數彙總，依未來 HR 定義） */
  monthly_leave_days: number;
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

export type LeaveRequestStatus = "pending" | "approved" | "rejected" | "revoked";

export interface LeaveRequestRow {
  id: string;
  type_label: string;
  start_date: string;
  end_date: string;
  status: LeaveRequestStatus;
  /** 已核准且為扣薪假時，計入本月扣薪天數 */
  deducts_salary: boolean;
  days_count: number;
  /** 特休：請假起始日之整點區間（與 DB start_hour/end_hour 對齊） */
  start_hour?: number | null;
  end_hour?: number | null;
  /** 請假結束日之整點區間（跨日特休） */
  end_day_start_hour?: number | null;
  end_day_end_hour?: number | null;
  hours_count?: number | null;
  /** 請假事由（leave_requests.reason） */
  reason?: string | null;
  /** 申請建立時間 */
  created_at?: string | null;
  /** 最後更新（leave_requests.updated_at；核准／退回或內容修改） */
  updated_at?: string | null;
}

/** 進度下拉：待處理 | 進行中 | 已完成 */
export type WorkProgressUiStatus = "pending" | "in_progress" | "done";

/** 生產工單進度列（狀態由頁面 React state 管理，此處僅種子資料） */
export interface WorkProgressSeedRow {
  id: string;
  /** 訂單/生產單號 */
  order_ref: string;
  /** 負責工序 */
  stage_label: string;
  expected_complete_date: string;
  /** 自 work_orders 等帶入時，用於初始下拉狀態 */
  initial_ui_status?: WorkProgressUiStatus;
}

/** payslips 資料表（Mock）；未來 supabase.from('payslips').select(...) */
export type PayslipStatus = "paid" | "calculating";

export interface PayslipDetailBreakdown {
  base_salary: number;
  /** 勞保自付額（結算快照） */
  labor_insurance_employee: number;
  /** 健保自付額（結算快照） */
  health_insurance_employee: number;
  /** 健保加保人數（employees.health_insured_persons 快照） */
  health_insured_persons: number | null;
  /** 加班天數 */
  overtime_days: number;
  /** 加班費（正數） */
  overtime_pay: number;
  /** 本月核准特休天數（結算自餘額扣除） */
  special_leave_days_settled: number;
  /** 該月結算後剩餘特休快照（payslips.special_leave_remaining_after；舊資料 null） */
  special_leave_remaining_after: number | null;
  /** 該月結算後補休剩餘快照（小時，payslips.comp_leave_remaining_after；舊資料 null） */
  comp_leave_remaining_after: number | null;
  /** 事假／病假等計薪天數（扣款依據；結算月內） */
  leave_days: number;
  /** 其他假期天數（婚假、生理假等非特休、非事假病假） */
  other_leave_days: number;
  /** 其他假期假別明細，如「婚假 2 天、生理假 1 天」 */
  other_leave_detail: string | null;
  /** 考績／分潤／年度獎金（payslips.payroll_bonus） */
  payroll_bonus: number;
  /** 請假扣款：事假／病假等（正數金額，顯示為減項） */
  leave_deduction: number;
  /** 其他加減項（正數加、負數減；0 可省略列） */
  other_adjust: number;
  /** 實發總額 */
  net_pay: number;
}

export interface PayslipRow {
  id: string;
  /** 排序用 YYYY-MM */
  period_key: string;
  /** 顯示用，例如 2026 年 2 月 */
  month_label: string;
  /** 列表與明細結算應一致 */
  net_pay: number;
  status: PayslipStatus;
  breakdown: PayslipDetailBreakdown;
  /** payslips.notes：出勤／假單／加班彙整備註 */
  notes: string | null;
}

/** 員工為工單負責人時，生產交辦區塊顯示之 work_orders（與生產管理列表對齊；聯絡人僅附於客戶欄供辨識，不獨立欄） */
export interface AssigneeWorkOrderRow {
  id: string;
  order_id: string | null;
  order_number: string;
  customer_name: string;
  customer_alias: string | null;
  /** orders.shipping_contact_name */
  shipping_contact_name: string | null;
  /** 品項＋尺寸，同生產管理「品項 / 尺寸」 */
  item_size_label: string;
  quantity: number;
  category: string;
  stage: string | null;
  planned_start_date: string | null;
  planned_end_date: string | null;
  expected_delivery_date: string | null;
  order_status: string | null;
}

export interface EmployeePortalPayload {
  employee: EmployeePortalEmployee;
  stats: EmployeePortalStats;
  announcements: AnnouncementRow[];
  tasks: EmployeeTaskRow[];
  leave_requests: LeaveRequestRow[];
  work_progress_seed: WorkProgressSeedRow[];
  /** 您為負責人之工單（work_orders.assignee_id） */
  assignee_work_orders: AssigneeWorkOrderRow[];
  payslips: PayslipRow[];
}

export const workProgressStatusLabels: Record<WorkProgressUiStatus, string> = {
  pending: "待處理",
  in_progress: "進行中",
  done: "已完成",
};

export const employeePortalMock: EmployeePortalPayload = {
  employee: {
    id: "emp-mock-001",
    full_name: "林雅婷",
    base_salary: 42000,
    annual_leave_remaining: 12.5,
    comp_leave_remaining: 24,
    hire_date: "2022-11-14",
    unpaid_leave_months: null,
  },
  stats: {
    monthly_salary_ntd: 43800,
    monthly_overtime_days: 4,
    monthly_leave_days: 2.5,
  },
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
      id: "ann-4",
      title: "塗裝線保養日",
      body: "下週二下午 B 線停機保養，相關工單請提前與組長協調轉線或順延。",
      published_at: "2026-03-14",
      is_active: true,
    },
    {
      id: "ann-5",
      title: "消防演練預告",
      body: "本月最後一個週五 16:00 全廠消防演練，聽到警鈴請依疏散路線至集合點。",
      published_at: "2026-03-12",
      is_active: true,
    },
    {
      id: "ann-6",
      title: "新人導師制度上線",
      body: "到職首月將指派導師協助熟悉機台與表單，詳見內部公告附件。",
      published_at: "2026-03-10",
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
    {
      id: "t4",
      title: "週會資料：本組產能與延遲原因整理",
      status: "in_progress",
      due_date: "2026-03-21",
    },
    {
      id: "t5",
      title: "庫存盤點標籤補印（C 倉）",
      status: "todo",
      due_date: "2026-03-26",
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
      start_hour: 9,
      end_hour: 18,
      hours_count: 8,
      reason: "返鄉掃墓",
    },
    {
      id: "lr2",
      type_label: "病假",
      start_date: "2026-03-10",
      end_date: "2026-03-11",
      status: "approved",
      deducts_salary: true,
      days_count: 1.5,
      created_at: "2026-03-01T10:00:00+08:00",
      updated_at: "2026-03-02T14:30:00+08:00",
    },
    {
      id: "lr3",
      type_label: "事假",
      start_date: "2026-02-20",
      end_date: "2026-02-20",
      status: "rejected",
      deducts_salary: true,
      days_count: 1,
      reason: "辦理證件",
    },
  ],
  assignee_work_orders: [
    {
      id: "wo-mock-1",
      order_id: "order-mock-8841",
      order_number: "ORD-8841",
      customer_name: "謝木木工作室",
      customer_alias: null,
      shipping_contact_name: "陳大明",
      item_size_label: "餐桌系列 B / W:140 x D:80 x H:75",
      quantity: 3,
      category: "桌",
      stage: "組裝中(一)",
      planned_start_date: "2026-03-18",
      planned_end_date: "2026-03-25",
      expected_delivery_date: "2026-04-26",
      order_status: "生產中",
    },
    {
      id: "wo-mock-2",
      order_id: "order-mock-8850",
      order_number: "ORD-8850",
      customer_name: "謝木木工作室",
      customer_alias: "專案 A",
      shipping_contact_name: "林小姐",
      item_size_label: "ST01-C / W:40 x D:48 x H:75",
      quantity: 3,
      category: "凳",
      stage: "待排程",
      planned_start_date: "2026-03-20",
      planned_end_date: "2026-03-28",
      expected_delivery_date: "2026-04-20",
      order_status: "生產中",
    },
  ],
  work_progress_seed: [
    {
      id: "wp1",
      order_ref: "WO-2026-0312 · ORD-8841",
      stage_label: "砂光",
      expected_complete_date: "2026-03-21",
    },
    {
      id: "wp2",
      order_ref: "WO-2026-0315 · ORD-8850",
      stage_label: "塗裝（底漆）",
      expected_complete_date: "2026-03-24",
    },
    {
      id: "wp3",
      order_ref: "WO-2026-0308 · ORD-8822",
      stage_label: "組裝",
      expected_complete_date: "2026-03-20",
    },
    {
      id: "wp4",
      order_ref: "WO-2026-0318 · ORD-8863",
      stage_label: "品檢／包裝",
      expected_complete_date: "2026-03-27",
    },
  ],
  payslips: [
    {
      id: "ps-2026-03",
      period_key: "2026-03",
      month_label: "2026 年 3 月",
      net_pay: 43800,
      status: "calculating",
      notes: null,
      breakdown: {
        base_salary: 42000,
        labor_insurance_employee: 1260,
        health_insurance_employee: 826,
        health_insured_persons: 3,
        overtime_days: 4,
        overtime_pay: 4800,
        special_leave_days_settled: 1,
        special_leave_remaining_after: 12.5,
        comp_leave_remaining_after: 24,
        leave_days: 1,
        other_leave_days: 2,
        other_leave_detail: "婚假 2 天",
        payroll_bonus: 5000,
        leave_deduction: 914,
        other_adjust: 0,
        net_pay: 43800,
      },
    },
    {
      id: "ps-2026-02",
      period_key: "2026-02",
      month_label: "2026 年 2 月",
      net_pay: 45120,
      status: "paid",
      notes:
        "3/2 遲到 12分, 3/8 特休 1天, 3/15 假日加班轉補休 6hr, 3/20 事假 4hr",
      breakdown: {
        base_salary: 42000,
        labor_insurance_employee: 1260,
        health_insurance_employee: 826,
        health_insured_persons: 3,
        overtime_days: 5,
        overtime_pay: 6120,
        special_leave_days_settled: 0,
        special_leave_remaining_after: 13.5,
        comp_leave_remaining_after: 16,
        leave_days: 1,
        other_leave_days: 0,
        other_leave_detail: null,
        payroll_bonus: 0,
        leave_deduction: 914,
        other_adjust: 0,
        net_pay: 45120,
      },
    },
    {
      id: "ps-2026-01",
      period_key: "2026-01",
      month_label: "2026 年 1 月",
      net_pay: 42850,
      status: "paid",
      notes: "1/10 特休 2天, 1/22 缺卡",
      breakdown: {
        base_salary: 42000,
        labor_insurance_employee: 1260,
        health_insurance_employee: 826,
        health_insured_persons: 3,
        overtime_days: 3,
        overtime_pay: 3850,
        special_leave_days_settled: 2,
        special_leave_remaining_after: 13.5,
        comp_leave_remaining_after: null,
        leave_days: 1,
        other_leave_days: 1,
        other_leave_detail: "生理假 1 天",
        payroll_bonus: 0,
        leave_deduction: 914,
        other_adjust: 0,
        net_pay: 42850,
      },
    },
    {
      id: "ps-2025-12",
      period_key: "2025-12",
      month_label: "2025 年 12 月",
      net_pay: 46500,
      status: "paid",
      notes: null,
      breakdown: {
        base_salary: 42000,
        labor_insurance_employee: 1260,
        health_insurance_employee: 826,
        health_insured_persons: 4,
        overtime_days: 7,
        overtime_pay: 10500,
        special_leave_days_settled: 0,
        special_leave_remaining_after: null,
        comp_leave_remaining_after: null,
        leave_days: 3,
        other_leave_days: 0,
        other_leave_detail: null,
        payroll_bonus: 0,
        leave_deduction: 3914,
        other_adjust: 0,
        net_pay: 46500,
      },
    },
  ],
};

/**
 * 預留：改為 Supabase 查詢後組裝為 EmployeePortalPayload。
 * payslips：await supabase.from('payslips').select('*').eq('employee_id', id).order('period_key', { ascending: false })
 */
export async function fetchEmployeePortalData(): Promise<EmployeePortalPayload> {
  await new Promise((r) => setTimeout(r, 120));
  return employeePortalMock;
}

export function activeAnnouncements(rows: AnnouncementRow[]): AnnouncementRow[] {
  return rows.filter((a) => a.is_active).sort((a, b) => (a.published_at > b.published_at ? 1 : -1));
}
