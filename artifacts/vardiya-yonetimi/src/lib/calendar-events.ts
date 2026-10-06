import type { CalendarEvent, CalendarEventInput, Leave } from "@workspace/api-client-react"
import { dayKey, shiftDay, validDay } from "./leave-occupancy.ts"

export const NEAR_DAYS = 7

export type CalendarFocus = { leaveId: number; employeeName: string; start: string; end: string }

export function eventsOnDay(events: CalendarEvent[], date: string): CalendarEvent[] {
  return events.filter(e => dayKey(e.startDate) <= date && dayKey(e.endDate) >= date)
    .sort((a, b) => a.title.localeCompare(b.title, "tr") || a.id - b.id)
}

export function inclusiveDays(start: string, end: string): number {
  return Math.round((Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 86400000) + 1
}

export function nearWindow(focus: CalendarFocus) {
  return { from: shiftDay(focus.start, -NEAR_DAYS), to: shiftDay(focus.end, NEAR_DAYS) }
}

export type NearbyKind = "overlap" | "near"
export function nearbyItems(focus: CalendarFocus, leaves: Leave[], events: CalendarEvent[]) {
  const { from, to } = nearWindow(focus)
  const kind = (s: string, e: string): NearbyKind => (s <= focus.end && e >= focus.start ? "overlap" : "near")
  const rank = (a: { start: string; kind: NearbyKind }, b: { start: string; kind: NearbyKind }) =>
    (a.kind === b.kind ? 0 : a.kind === "overlap" ? -1 : 1) || a.start.localeCompare(b.start)
  const otherLeaves = leaves
    .filter(l => l.id !== focus.leaveId && l.status !== "rejected" && dayKey(l.startDate) <= to && dayKey(l.endDate) >= from)
    .map(l => ({ leave: l, start: dayKey(l.startDate), end: dayKey(l.endDate), kind: kind(dayKey(l.startDate), dayKey(l.endDate)) }))
    .sort((a, b) => rank(a, b) || a.leave.employeeName.localeCompare(b.leave.employeeName, "tr"))
  const nearEvents = events
    .filter(e => dayKey(e.startDate) <= to && dayKey(e.endDate) >= from)
    .map(e => ({ event: e, start: dayKey(e.startDate), end: dayKey(e.endDate), kind: kind(dayKey(e.startDate), dayKey(e.endDate)) }))
    .sort((a, b) => rank(a, b) || a.event.title.localeCompare(b.event.title, "tr"))
  return { from, to, leaves: otherLeaves, events: nearEvents }
}

export function validateEventInput(v: { title: string; description: string; startDate: string; endDate: string }): { ok: true; input: CalendarEventInput } | { ok: false; errors: Partial<Record<"title" | "description" | "startDate" | "endDate", string>> } {
  const errors: Partial<Record<"title" | "description" | "startDate" | "endDate", string>> = {}
  const title = v.title.trim()
  if (!title) errors.title = "Başlık gerekli."
  else if (title.length > 160) errors.title = "Başlık en fazla 160 karakter olabilir."
  if (v.description.length > 2000) errors.description = "Açıklama en fazla 2000 karakter olabilir."
  if (!validDay(v.startDate) || v.startDate.startsWith("0000-")) errors.startDate = "Geçerli bir başlangıç tarihi girin."
  if (!validDay(v.endDate) || v.endDate.startsWith("0000-")) errors.endDate = "Geçerli bir bitiş tarihi girin."
  else if (!errors.startDate && v.endDate < v.startDate) errors.endDate = "Bitiş tarihi başlangıçtan önce olamaz."
  if (Object.keys(errors).length) return { ok: false, errors }
  return { ok: true, input: { title, description: v.description.trim(), startDate: v.startDate, endDate: v.endDate } }
}
