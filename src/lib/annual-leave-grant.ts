import { seniorityFromHire } from "@/lib/employee-seniority";

/**
 * 勞基法第 38 條特休天數（依年資里程碑）：
 * 滿 6 個月（0.5）＝3 天、滿 1 年＝7、滿 2 年＝10、滿 3–4 年＝14、
 * 滿 5–9 年＝15、滿 10 年起每年加 1 天，加至 30 天為止。
 */
export function lsaAnnualLeaveDaysForMilestone(milestoneYears: number): number {
  if (milestoneYears === 0.5) return 3;
  const y = Math.floor(milestoneYears);
  if (y < 1) return 0;
  if (y === 1) return 7;
  if (y === 2) return 10;
  if (y <= 4) return 14;
  if (y <= 9) return 15;
  return Math.min(15 + (y - 9), 30);
}

export type AnnualLeaveMilestone = {
  /** 0.5＝滿六個月，1、2、3…＝滿 N 年 */
  milestoneYears: number;
  days: number;
};

export function milestoneLabel(milestoneYears: number): string {
  return milestoneYears === 0.5
    ? "滿6個月"
    : `滿${milestoneYears}年`;
}

/**
 * 截至 asOf 已達成的所有年資里程碑（年資以到職日起算、扣除留職停薪月份，
 * 與 seniorityFromHire 一致）。尚未套用「已授予」過濾。
 */
export function dueAnnualLeaveMilestones(
  hireDate: string | null,
  asOf: Date,
  unpaidLeaveMonths?: string[] | null,
): AnnualLeaveMilestone[] {
  if (!hireDate) return [];
  const s = seniorityFromHire(hireDate, asOf, unpaidLeaveMonths);
  const totalMonths = s.years * 12 + s.months;
  const list: AnnualLeaveMilestone[] = [];
  if (totalMonths >= 6) {
    list.push({ milestoneYears: 0.5, days: lsaAnnualLeaveDaysForMilestone(0.5) });
  }
  for (let y = 1; y * 12 <= totalMonths; y += 1) {
    list.push({ milestoneYears: y, days: lsaAnnualLeaveDaysForMilestone(y) });
  }
  return list;
}

/** 下一個尚未達成的里程碑與距離月數（供欄位 tooltip 顯示） */
export function nextAnnualLeaveMilestone(
  hireDate: string | null,
  asOf: Date,
  unpaidLeaveMonths?: string[] | null,
): (AnnualLeaveMilestone & { monthsAway: number }) | null {
  if (!hireDate) return null;
  const s = seniorityFromHire(hireDate, asOf, unpaidLeaveMonths);
  const totalMonths = s.years * 12 + s.months;
  if (totalMonths < 6) {
    return {
      milestoneYears: 0.5,
      days: lsaAnnualLeaveDaysForMilestone(0.5),
      monthsAway: 6 - totalMonths,
    };
  }
  const nextYears = Math.floor(totalMonths / 12) + 1;
  return {
    milestoneYears: nextYears,
    days: lsaAnnualLeaveDaysForMilestone(nextYears),
    monthsAway: nextYears * 12 - totalMonths,
  };
}
