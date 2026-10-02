import assert from "node:assert/strict";
import test from "node:test";
import {
  annualBalance,
  annualBookingError,
  annualCycleBalances,
  annualHourBreakdown,
  annualHourEntries,
  buildAnnualHourSnapshot,
  deductedAnnualHours,
  HOURS_PER_ENTITLEMENT_DAY,
} from "../src/routes/annual-leave.ts";

const employee = (hireDate = "2020-01-01") => ({
  id: 7,
  employeeNumber: "E7",
  name: "Test employee",
  department: "Operations",
  role: "Staff",
  weeklyHours: 40,
  annualLeaveDays: 20,
  annualLeaveDaysOverride: null,
  hireDate,
  usedLeaveDays: 0,
  status: "active",
  avatarColor: "#000",
  photoPath: null,
}) as any;

function schedule(hoursByWeekday: Record<number, number>) {
  return {
    id: 1,
    department: "Operations",
    days: Array.from({ length: 7 }, (_, index) => ({
      weekday: index + 1,
      dayName: "",
      hours: hoursByWeekday[index + 1] ?? 0,
    })),
    updatedAt: new Date(),
  } as any;
}

const leave = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  employeeId: 7,
  type: "annual",
  settlementType: "full",
  startDate: "2024-01-01",
  endDate: "2024-01-01",
  days: 1,
  status: "pending",
  note: "",
  reviewedByUserId: null,
  reviewedByName: null,
  reviewedAt: null,
  annualHourSnapshot: [{ date: "2024-01-01", hours: 8 }],
  ...overrides,
}) as any;

test("20 annual entitlement days represent 180 hours", () => {
  const result = annualBalance(employee(), 20, [], "2024-01-01");
  assert.equal(result.annualLeaveHours, 20 * HOURS_PER_ENTITLEMENT_DAY);
  assert.equal(result.remainingAnnualLeaveHours, 180);
  assert.equal(result.remainingAnnualLeaveDays, 20);
});

test("snapshots use per-day schedule hours and the latest matching special period", () => {
  const fixed = schedule({ 1: 8, 2: 7, 3: 6, 4: 5, 5: 4 });
  const periods = [
    { id: 2, department: "Operations", startDate: "2024-01-01", endDate: "2024-01-05",
      days: schedule({ 1: 3, 2: 3, 3: 3, 4: 3, 5: 3 }).days },
    { id: 3, department: "Operations", startDate: "2024-01-02", endDate: "2024-01-02",
      days: schedule({ 1: 2, 2: 2, 3: 2, 4: 2, 5: 2 }).days },
  ] as any;
  const entries = buildAnnualHourSnapshot(employee(), "2024-01-01", "2024-01-03", fixed, periods);
  assert.deepEqual(entries.map(({ hours }) => hours), [3, 2, 3]);
});

test("hour entries split across the hire anniversary cycle", () => {
  const split = annualHourBreakdown("2020-06-15", "2024-06-13", "2024-06-17", [
    { date: "2024-06-13", hours: 8 },
    { date: "2024-06-14", hours: 8 },
    { date: "2024-06-15", hours: 0 },
    { date: "2024-06-16", hours: 0 },
    { date: "2024-06-17", hours: 6 },
  ]);
  assert.deepEqual(split, [
    { cycleStart: "2023-06-15", hours: 16 },
    { cycleStart: "2024-06-15", hours: 6 },
  ]);
});

test("cycle balances cover each touched anniversary cycle and include approved and pending bookings", () => {
  const approved = leave({
    status: "approved",
    annualHourSnapshot: [{ date: "2024-06-13", hours: 9 }],
  });
  const pending = leave({
    id: 2,
    status: "pending",
    annualHourSnapshot: [{ date: "2024-06-17", hours: 8 }],
  });
  assert.deepEqual(
    annualCycleBalances("2020-06-15", 20, [approved, pending], "2024-06-14", "2024-06-17"),
    [
      {
        startDate: "2023-06-15",
        endDate: "2024-06-14",
        entitlementHours: 180,
        usedHours: 9,
        pendingHours: 0,
        remainingHours: 171,
      },
      {
        startDate: "2024-06-15",
        endDate: "2025-06-14",
        entitlementHours: 180,
        usedHours: 0,
        pendingHours: 8,
        remainingHours: 172,
      },
    ],
  );
});

test("leave response hour breakdown remains day-by-day and preserves zero-hour snapshot dates", () => {
  const snapshotted = leave({
    startDate: "2024-06-14",
    endDate: "2024-06-16",
    annualHourSnapshot: [
      { date: "2024-06-14", hours: 8 },
      { date: "2024-06-15", hours: 0 },
      { date: "2024-06-16", hours: 0 },
    ],
  });
  assert.deepEqual(annualHourEntries(snapshotted), snapshotted.annualHourSnapshot);

  const legacy = leave({
    startDate: "2024-06-14",
    endDate: "2024-06-17",
    annualHourSnapshot: null,
  });
  assert.deepEqual(annualHourEntries(legacy), [
    { date: "2024-06-14", hours: 9 },
    { date: "2024-06-17", hours: 9 },
  ]);

  const weekendOnlyLegacy = leave({
    startDate: "2024-06-15",
    endDate: "2024-06-16",
    annualHourSnapshot: null,
  });
  assert.deepEqual(annualHourEntries(weekendOnlyLegacy), [
    { date: "2024-06-15", hours: 9 },
  ]);
});

test("pending snapshot hours reserve entitlement", () => {
  const pending = leave({
    annualHourSnapshot: [{ date: "2024-01-02", hours: 12 }],
  });
  const error = annualBookingError(
    employee(), 2, [pending], "2024-01-03", "2024-01-03", undefined,
    [{ date: "2024-01-03", hours: 8 }],
  );
  assert.match(error ?? "", /kalan yıllık izin hakkı 6 saat/);
});

test("legacy leaves retain weekday charge, weekend minimum, and cycle split", () => {
  const legacy = leave({
    startDate: "2024-06-14",
    endDate: "2024-06-17",
    annualHourSnapshot: null,
  });
  assert.equal(deductedAnnualHours(legacy), 18);
  assert.equal(deductedAnnualHours(legacy), 18);
  assert.deepEqual(
    annualHourBreakdown("2020-06-15", legacy.startDate, legacy.endDate, null),
    [
      { cycleStart: "2023-06-15", hours: 9 },
      { cycleStart: "2024-06-15", hours: 9 },
    ],
  );
  const weekendOnly = leave({
    startDate: "2024-06-15",
    endDate: "2024-06-16",
    annualHourSnapshot: null,
  });
  assert.equal(deductedAnnualHours(weekendOnly), 9);
});