import assert from "node:assert/strict";
import test from "node:test";
import { calendarEventDateError, isCalendarDate } from "./calendar-event-validation.ts";

test("real calendar dates, leap days and single-day events are accepted", () => {
  for (const date of ["2026-10-06", "2024-02-29", "2026-12-31", "2027-01-01"]) {
    assert.equal(isCalendarDate(date), true);
    assert.equal(calendarEventDateError(date, date), null);
  }
  assert.equal(calendarEventDateError("2026-12-31", "2027-01-01"), null);
});

test("invalid and normalized dates cannot silently become other calendar days", () => {
  for (const date of ["2026-02-29", "2026-02-30", "2026-04-31", "2026-13-01", "0000-01-01", "2026-10-06T00:00:00Z", "", null, 42]) {
    assert.equal(isCalendarDate(date), false);
    assert.ok(calendarEventDateError(date, "2026-10-06"));
  }
});

test("reversed ranges are rejected", () => {
  assert.ok(calendarEventDateError("2026-10-07", "2026-10-06"));
});
