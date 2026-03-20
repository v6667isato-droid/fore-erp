/**
 * 休息日加班費試算（依月薪）
 * (月薪÷240×4/3×2) + (月薪÷240×5/3×6)
 */
export function computeRestDayOvertimePay(
  monthlyWage: number | null | undefined,
): number | null {
  if (
    monthlyWage == null ||
    !Number.isFinite(monthlyWage) ||
    monthlyWage <= 0
  ) {
    return null;
  }
  const m = monthlyWage;
  return (m / 240) * (4 / 3) * 2 + (m / 240) * (5 / 3) * 6;
}
