type CapacityLeave = {
  id: number;
  employeeId: number;
  type: string;
  status: string;
  startDate: string;
  endDate: string;
};

// Inclusive calendar dates; count distinct people, not leave records.
export function annualCapacityConflict(
  leaves: CapacityLeave[], start: string, end: string, employeeId: number, excludeId?: number,
): string | null {
  if (!start || !end || start > end) return null;
  const approved = leaves.filter(leave =>
    leave.type === "annual" && leave.status === "approved" &&
    leave.employeeId !== employeeId && leave.id !== excludeId &&
    leave.startDate.slice(0, 10) <= end && leave.endDate.slice(0, 10) >= start,
  );
  let first: string | null = null;
  for (let i = 0; i < approved.length; i++) {
    for (let j = i + 1; j < approved.length; j++) {
      const a = approved[i], b = approved[j];
      if (a.employeeId === b.employeeId) continue;
      const from = [start, a.startDate.slice(0, 10), b.startDate.slice(0, 10)].sort().at(-1)!;
      const to = [end, a.endDate.slice(0, 10), b.endDate.slice(0, 10)].sort()[0];
      if (from <= to && (!first || from < first)) first = from;
    }
  }
  return first;
}

export function annualCapacityMessage(date: string): string {
  return `${date} tarihinde iki farklı personelin yıllık izni zaten onaylı. Aynı gün üçüncü bir kişi için yıllık izin eklenemez veya onaylanamaz. Tarihleri değiştirin.`;
}
