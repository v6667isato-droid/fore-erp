/**
 * 月曆網格用日期工具（不依賴 date-fns）。
 * 一週由「週一」開始，與介面表頭一致。
 */

export interface MonthDayCell {
  year: number;
  month: number;
  /** 1–12 */
  day: number;
  isCurrentMonth: boolean;
}

/** 該月天數（month 為 1–12） */
export function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** 將 Date.getDay()（日=0…六=6）轉成「週一為 0 … 週日為 6」 */
export function mondayBasedWeekday(date: Date): number {
  return (date.getDay() + 6) % 7;
}

/**
 * 產生當月完整網格（含前後月補齊的日期），每格 7 欄對齊週一到週日。
 */
export function buildCalendarMonthGrid(year: number, month: number): MonthDayCell[] {
  const first = new Date(year, month - 1, 1);
  const leading = mondayBasedWeekday(first);
  const count = getDaysInMonth(year, month);

  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const prevCount = getDaysInMonth(prevYear, prevMonth);

  const cells: MonthDayCell[] = [];

  for (let i = 0; i < leading; i++) {
    const day = prevCount - leading + i + 1;
    cells.push({ year: prevYear, month: prevMonth, day, isCurrentMonth: false });
  }

  for (let d = 1; d <= count; d++) {
    cells.push({ year, month, day: d, isCurrentMonth: true });
  }

  let nextYear = year;
  let nextMonth = month + 1;
  if (nextMonth > 12) {
    nextMonth = 1;
    nextYear += 1;
  }
  let filler = 1;
  while (cells.length % 7 !== 0) {
    cells.push({
      year: nextYear,
      month: nextMonth,
      day: filler++,
      isCurrentMonth: false,
    });
  }

  return cells;
}

export function formatDateKey(year: number, month: number, day: number): string {
  const m = String(month).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${year}-${m}-${d}`;
}
