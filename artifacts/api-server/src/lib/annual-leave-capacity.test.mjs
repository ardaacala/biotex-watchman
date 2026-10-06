import assert from "node:assert/strict";
import test from "node:test";
import { annualCapacityConflict } from "./annual-leave-capacity.ts";

const booking = (id, employeeId, startDate, endDate, extra = {}) =>
  ({ id, employeeId, startDate, endDate, type: "annual", status: "approved", ...extra });

test("a single shared day, including either boundary, blocks a third person", () => {
  const leaves = [
    booking(1, 1, "2026-10-01", "2026-10-05"),
    booking(2, 2, "2026-10-05", "2026-10-09"),
  ];
  assert.equal(annualCapacityConflict(leaves, "2026-10-05", "2026-10-05", 3), "2026-10-05");
  assert.equal(annualCapacityConflict(leaves, "2026-10-02", "2026-10-05", 3), "2026-10-05");
  assert.equal(annualCapacityConflict(leaves, "2026-10-05", "2026-10-10", 3), "2026-10-05");
});

test("overlapping each person on different days does not exhaust daily capacity", () => {
  const leaves = [
    booking(1, 1, "2026-10-01", "2026-10-03"),
    booking(2, 2, "2026-10-04", "2026-10-07"),
  ];
  assert.equal(annualCapacityConflict(leaves, "2026-10-01", "2026-10-07", 3), null);
});

test("one approved person allows a second; pending/rejected and nonannual do not count", () => {
  for (const extra of [{ status: "pending" }, { status: "rejected" }, { type: "sick" }, { type: "unpaid" }, { type: "other" }]) {
    const leaves = [booking(1, 1, "2026-10-01", "2026-10-09"), booking(2, 2, "2026-10-01", "2026-10-09", extra)];
    assert.equal(annualCapacityConflict(leaves, "2026-10-05", "2026-10-05", 3), null);
  }
});

test("multiple records for one person are not two people", () => {
  const leaves = [booking(1, 1, "2026-10-01", "2026-10-09"), booking(2, 1, "2026-10-02", "2026-10-08")];
  assert.equal(annualCapacityConflict(leaves, "2026-10-05", "2026-10-05", 3), null);
  leaves.push(booking(3, 2, "2026-10-05", "2026-10-05"));
  assert.equal(annualCapacityConflict(leaves, "2026-10-05", "2026-10-05", 3), "2026-10-05");
});

test("the applicant and reviewed record are excluded", () => {
  const leaves = [booking(1, 1, "2026-10-01", "2026-10-09"), booking(2, 2, "2026-10-01", "2026-10-09")];
  assert.equal(annualCapacityConflict(leaves, "2026-10-05", "2026-10-05", 1), null);
  assert.equal(annualCapacityConflict(leaves, "2026-10-05", "2026-10-05", 3, 2), null);
});

test("returns earliest actual triple intersection and handles ISO timestamps", () => {
  const leaves = [
    booking(1, 1, "2026-10-06T00:00:00.000Z", "2026-10-09T00:00:00.000Z"),
    booking(2, 2, "2026-10-08", "2026-10-09"),
    booking(3, 3, "2026-10-07", "2026-10-07"),
  ];
  assert.equal(annualCapacityConflict(leaves, "2026-10-01", "2026-10-10", 4), "2026-10-07");
  assert.equal(annualCapacityConflict(leaves, "2026-10-01", "2026-10-05", 4), null);
});

test("calendar days across months/years and weekends count even for debt-settled annual leave", () => {
  const leaves = [
    booking(1, 1, "2026-12-31", "2027-01-02", { settlementType: "debt" }),
    booking(2, 2, "2027-01-02", "2027-01-05"),
  ];
  assert.equal(annualCapacityConflict(leaves, "2027-01-02", "2027-01-02", 3), "2027-01-02");
});
