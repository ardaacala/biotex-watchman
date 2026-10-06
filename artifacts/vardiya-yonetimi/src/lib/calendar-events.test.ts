import assert from "node:assert/strict"
import test from "node:test"
import type { CalendarEvent, Leave } from "@workspace/api-client-react"
import { nearWindow, nearbyItems, eventsOnDay, validateEventInput, inclusiveDays } from "./calendar-events.ts"

test("seven-day context handles month and year boundaries", () => {
  assert.deepEqual(nearWindow({ leaveId: 1, employeeName: "A", start: "2026-12-31", end: "2027-01-02" }), { from: "2026-12-24", to: "2027-01-09" })
  assert.equal(inclusiveDays("2026-10-06", "2026-10-06"), 1)
  assert.equal(inclusiveDays("2026-12-31", "2027-01-02"), 3)
})

test("event form validates and trims values without an additional test framework", () => {
  const form = { title: " x ", description: "", startDate: "2026-03-01", endDate: "2026-03-01" }
  assert.deepEqual(validateEventInput(form), { ok: true, input: { ...form, title: "x" } })
  for (const values of [
    { title: " " }, { title: "x".repeat(161) }, { description: "x".repeat(2001) },
    { startDate: "2026-02-30" }, { startDate: "0000-01-01" }, { endDate: "2026-02-28" },
  ]) assert.equal(validateEventInput({ ...form, ...values }).ok, false)
})

test("nearby items use inclusive boundaries, exclude the request and rejected leave", () => {
  const focus = { leaveId: 1, employeeName: "A", start: "2026-10-10", end: "2026-10-12" }
  const leave = (id: number, date: string, status = "approved") =>
    ({ id, employeeName: String(id), startDate: date, endDate: date, status } as Leave)
  const event = (id: number, startDate: string, endDate = startDate) =>
    ({ id, title: String(id), startDate, endDate } as CalendarEvent)
  const result = nearbyItems(focus, [
    leave(1, "2026-10-10"), leave(2, "2026-10-10"), leave(3, "2026-10-03", "pending"),
    leave(4, "2026-10-19"), leave(5, "2026-10-20"), leave(6, "2026-10-10", "rejected"),
  ], [event(1, "2026-10-12"), event(2, "2026-10-19"), event(3, "2026-10-02")])
  assert.deepEqual(result.leaves.map(item => [item.leave.id, item.kind]), [[2, "overlap"], [3, "near"], [4, "near"]])
  assert.deepEqual(result.events.map(item => [item.event.id, item.kind]), [[1, "overlap"], [2, "near"]])
  assert.equal(eventsOnDay([event(1, "2026-10-10", "2026-10-12")], "2026-10-12").length, 1)
  assert.equal(eventsOnDay([event(1, "2026-10-10", "2026-10-12")], "2026-10-13").length, 0)
})
