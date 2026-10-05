import assert from "node:assert/strict";
import test from "node:test";
import { retrospectiveDateError, hasBookedOverlap } from "./retrospective-leave.ts";

test("completed dates in this calendar year are allowed", () => {
  assert.equal(retrospectiveDateError("2026-01-01", "2026-01-03", "2026-10-05"), null);
});

test("last year, cross-year, future, today and reversed ranges are rejected", () => {
  for (const [start, end] of [
    ["2025-12-31", "2026-01-01"], ["2025-01-01", "2025-01-03"],
    ["2026-10-05", "2026-10-05"], ["2026-10-06", "2026-10-07"],
    ["2026-02-03", "2026-02-01"],
  ]) assert.ok(retrospectiveDateError(start, end, "2026-10-05"));
  assert.ok(retrospectiveDateError("2025-12-31", "2025-12-31", "2026-01-01"));
});

test("overlapping approved and pending dates cannot be booked twice", () => {
  for (const status of ["pending", "approved"]) {
    const booked = [{ startDate: "2026-04-02", endDate: "2026-04-04", status }];
    assert.equal(hasBookedOverlap(booked, "2026-04-04", "2026-04-05"), true);
    assert.equal(hasBookedOverlap(booked, "2026-04-01", "2026-04-06"), true);
    assert.equal(hasBookedOverlap(booked, "2026-04-05", "2026-04-05"), false);
  }
  assert.equal(hasBookedOverlap([{ startDate: "2026-04-02", endDate: "2026-04-04", status: "rejected" }], "2026-04-02", "2026-04-04"), false);
});
