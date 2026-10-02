import type {
  departmentSchedulesTable,
  employeesTable,
  leavesTable,
  LeaveHourSnapshotEntry,
  ScheduleDayRecord,
  specialPeriodsTable,
} from "@workspace/db";

type Employee = typeof employeesTable.$inferSelect;
type Leave = typeof leavesTable.$inferSelect;
type CycleHours = { used: number; pending: number };
export const HOURS_PER_ENTITLEMENT_DAY = 9;

export function buildAnnualHourSnapshot(
  employee: Employee,
  startDate: string,
  endDate: string,
  schedule: typeof departmentSchedulesTable.$inferSelect | undefined,
  periods: (typeof specialPeriodsTable.$inferSelect)[],
): LeaveHourSnapshotEntry[] {
  const snapshot: LeaveHourSnapshotEntry[] = [];
  for (let date = new Date(`${startDate}T00:00:00Z`), end = new Date(`${endDate}T00:00:00Z`);
    date <= end; date.setUTCDate(date.getUTCDate() + 1)) {
    const dateString = date.toISOString().slice(0, 10);
    const weekday = date.getUTCDay() || 7;
    const special = periods
      .filter((period) => period.department === employee.department
        && period.startDate <= dateString && period.endDate >= dateString)
      .sort((a, b) => b.id - a.id)[0];
    const scheduleDays: ScheduleDayRecord[] | undefined = special?.days ?? schedule?.days;
    const planned = scheduleDays?.find((day) => day.weekday === weekday)?.hours
      ?? (!schedule && !special && weekday <= 5 ? employee.weeklyHours / 5 : 0);
    snapshot.push({ date: dateString, hours: planned });
  }
  return snapshot;
}

// Old installations stored every personal entitlement here; 14 was the automatic default.
export function effectiveAnnualQuota(employee: Employee, departmentQuota = 14): number {
  return employee.annualLeaveDaysOverride
    ?? (employee.annualLeaveDays !== 14 ? employee.annualLeaveDays : departmentQuota);
}

function dayBefore(value: string): string {
  const day = new Date(`${value}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - 1);
  return day.toISOString().slice(0, 10);
}

function anniversary(hireDate: string, year: number): string {
  const monthDay = hireDate.slice(5);
  // 29 Şubat girişleri artık olmayan yıllarda 28 Şubat'ta yenilenir.
  const safeDay = monthDay === "02-29" && new Date(Date.UTC(year, 1, 29)).getUTCMonth() !== 1
    ? "02-28" : monthDay;
  return `${year}-${safeDay}`;
}

export function annualCycle(hireDate: string, date: string): { start: string; end: string } | null {
  if (date < hireDate) return null;
  const year = Number(date.slice(0, 4));
  const startYear = date >= anniversary(hireDate, year) ? year : year - 1;
  return { start: anniversary(hireDate, startYear), end: dayBefore(anniversary(hireDate, startYear + 1)) };
}

function iso(value: string | Date): string {
  return typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}

function legacyHoursByCycle(hireDate: string, start: string, end: string): Map<string, number> {
  const hours = new Map<string, number>();
  for (const day = new Date(`${start}T00:00:00Z`); iso(day) <= end; day.setUTCDate(day.getUTCDate() + 1)) {
    const weekday = day.getUTCDay();
    if (weekday !== 0 && weekday !== 6) {
      const cycle = annualCycle(hireDate, iso(day));
      if (cycle) hours.set(cycle.start, (hours.get(cycle.start) ?? 0) + HOURS_PER_ENTITLEMENT_DAY);
    }
  }
  // Önceki sistem hafta sonuyla sınırlı bir izin için de en az 1 gün sayıyordu.
  if (hours.size === 0) {
    const cycle = annualCycle(hireDate, start);
    if (cycle) hours.set(cycle.start, HOURS_PER_ENTITLEMENT_DAY);
  }
  return hours;
}

export function annualHourBreakdown(
  hireDate: string | null,
  startDate: string | Date,
  endDate: string | Date,
  snapshot: LeaveHourSnapshotEntry[] | null,
): { cycleStart: string; hours: number }[] {
  if (!hireDate) return [];
  const hoursByCycle = snapshot === null
    ? legacyHoursByCycle(hireDate, iso(startDate), iso(endDate))
    : new Map<string, number>();
  if (snapshot !== null) {
    for (const entry of snapshot) {
      const cycle = annualCycle(hireDate, entry.date);
      if (cycle) hoursByCycle.set(cycle.start, (hoursByCycle.get(cycle.start) ?? 0) + entry.hours);
    }
  }
  return [...hoursByCycle.entries()].map(([cycleStart, hours]) => ({ cycleStart, hours }));
}

export function annualHourEntries(leave: Leave): LeaveHourSnapshotEntry[] {
  if (leave.type !== "annual" || leave.settlementType !== "full") return [];
  if (leave.annualHourSnapshot !== null) return leave.annualHourSnapshot;

  const entries: LeaveHourSnapshotEntry[] = [];
  const start = new Date(`${iso(leave.startDate)}T00:00:00Z`);
  const end = new Date(`${iso(leave.endDate)}T00:00:00Z`);
  for (const date = new Date(start); date <= end; date.setUTCDate(date.getUTCDate() + 1)) {
    if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6) {
      entries.push({ date: iso(date), hours: HOURS_PER_ENTITLEMENT_DAY });
    }
  }
  if (!entries.length) entries.push({ date: iso(start), hours: HOURS_PER_ENTITLEMENT_DAY });
  return entries;
}

export function deductedAnnualHours(leave: Leave): number {
  return annualHourEntries(leave).reduce((total, entry) => total + entry.hours, 0);
}

function bookedHoursByCycle(hireDate: string, leaves: Leave[], excludedId?: number) {
  const booked = new Map<string, CycleHours>();
  for (const leave of leaves) {
    if (leave.id === excludedId || leave.type !== "annual" || leave.settlementType !== "full"
      || (leave.status !== "approved" && leave.status !== "pending")) continue;
    for (const { cycleStart: cycle, hours } of annualHourBreakdown(
      hireDate, leave.startDate, leave.endDate, leave.annualHourSnapshot,
    )) {
      const current = booked.get(cycle) ?? { used: 0, pending: 0 };
      current[leave.status === "approved" ? "used" : "pending"] += hours;
      booked.set(cycle, current);
    }
  }
  return booked;
}

export function annualCycleBalances(
  hireDate: string | null,
  quota: number,
  leaves: Leave[],
  startDate: string | Date,
  endDate: string | Date,
): {
  startDate: string;
  endDate: string;
  entitlementHours: number;
  usedHours: number;
  pendingHours: number;
  remainingHours: number;
}[] {
  if (!hireDate) return [];
  const touchedCycles = new Map<string, { start: string; end: string }>();
  const start = iso(startDate);
  const end = iso(endDate);
  for (const date = new Date(`${start}T00:00:00Z`); iso(date) <= end; date.setUTCDate(date.getUTCDate() + 1)) {
    const cycle = annualCycle(hireDate, iso(date));
    if (cycle) touchedCycles.set(cycle.start, cycle);
  }
  const booked = bookedHoursByCycle(hireDate, leaves);
  const entitlementHours = quota * HOURS_PER_ENTITLEMENT_DAY;
  return [...touchedCycles.values()].map((cycle) => {
    const current = booked.get(cycle.start) ?? { used: 0, pending: 0 };
    return {
      startDate: cycle.start,
      endDate: cycle.end,
      entitlementHours,
      usedHours: current.used,
      pendingHours: current.pending,
      remainingHours: Math.max(0, entitlementHours - current.used - current.pending),
    };
  });
}

export function todayInIstanbul(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function annualBalance(employee: Employee, quota: number, leaves: Leave[], asOf = todayInIstanbul()) {
  const hireDate = employee.hireDate;
  const cycle = hireDate ? annualCycle(hireDate, asOf) : null;
  const booked = cycle ? bookedHoursByCycle(hireDate!, leaves).get(cycle.start) : undefined;
  const usedHours = booked?.used ?? 0;
  const pendingHours = booked?.pending ?? 0;
  const quotaHours = quota * HOURS_PER_ENTITLEMENT_DAY;
  return {
    ...employee,
    annualLeaveDays: quota,
    annualLeaveDaysOverride: employee.annualLeaveDaysOverride
      ?? (employee.annualLeaveDays !== 14 ? employee.annualLeaveDays : null),
    hireDate,
    annualLeaveHours: quotaHours,
    usedLeaveHours: usedHours,
    pendingAnnualLeaveHours: pendingHours,
    remainingAnnualLeaveHours: cycle ? Math.max(0, quotaHours - usedHours - pendingHours) : null,
    usedLeaveDays: usedHours / HOURS_PER_ENTITLEMENT_DAY,
    pendingAnnualLeaveDays: pendingHours / HOURS_PER_ENTITLEMENT_DAY,
    remainingAnnualLeaveDays: cycle
      ? Math.max(0, quotaHours - usedHours - pendingHours) / HOURS_PER_ENTITLEMENT_DAY : null,
    leaveCycleStart: cycle?.start ?? null,
    leaveCycleEnd: cycle?.end ?? null,
  };
}

export function annualBookingError(
  employee: Employee, quota: number, leaves: Leave[], start: string, end: string, excludedId?: number,
  requestedSnapshot?: LeaveHourSnapshotEntry[],
): string | null {
  if (!employee.hireDate) return "Önce personelin işe başlama tarihini kaydedin.";
  if (start < employee.hireDate) return "Yıllık izin işe başlama tarihinden önce olamaz.";
  const booked = bookedHoursByCycle(employee.hireDate, leaves, excludedId);
  const requestedByCycle = annualHourBreakdown(employee.hireDate, start, end, requestedSnapshot ?? null);
  const quotaHours = quota * HOURS_PER_ENTITLEMENT_DAY;
  for (const { cycleStart: cycle, hours: requested } of requestedByCycle) {
    const current = booked.get(cycle) ?? { used: 0, pending: 0 };
    if (current.used + current.pending + requested > quotaHours) {
      return `${cycle} döneminde kalan yıllık izin hakkı ${Math.max(0, quotaHours - current.used - current.pending)} saat; ${requested} saat talep edilemez.`;
    }
  }
  return null;
}

export function annualQuotaError(employee: Employee, quota: number, leaves: Leave[]): string | null {
  if (!employee.hireDate) return null;
  for (const leave of leaves) {
    if (leave.type === "annual" && leave.settlementType === "full"
      && leave.status !== "rejected" && iso(leave.startDate) < employee.hireDate) {
      return "İşe başlama tarihi, kayıtlı yıllık izinlerden sonra olamaz.";
    }
  }
  for (const [cycle, hours] of bookedHoursByCycle(employee.hireDate, leaves)) {
    if (hours.used + hours.pending > quota * HOURS_PER_ENTITLEMENT_DAY) {
      return `${cycle} dönemindeki onaylı ve bekleyen yıllık izinler ${hours.used + hours.pending} saat. Hak ${quota * HOURS_PER_ENTITLEMENT_DAY} saate düşürülemez.`;
    }
  }
  return null;
}