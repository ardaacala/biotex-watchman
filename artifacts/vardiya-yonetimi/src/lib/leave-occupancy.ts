import type { Leave } from "@workspace/api-client-react"

export type OccupancyLeave = Pick<Leave, "id" | "employeeId" | "employeeName" | "startDate" | "endDate" | "status">

const DAY = 86400000
export function dayKey(value: string): string {
  return value.slice(0, 10)
}

export function validDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T12:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function dayNumber(value: string): number {
  return Date.parse(`${dayKey(value)}T12:00:00Z`)
}

export function fromDayNumber(value: number): string {
  return new Date(value).toISOString().slice(0, 10)
}

export function shiftDay(value: string, amount: number): string {
  return fromDayNumber(dayNumber(value) + amount * DAY)
}

export function todayInIstanbul(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date())
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? ""
  return `${part("year")}-${part("month")}-${part("day")}`
}

export function weekStart(value: string): string {
  const weekday = new Date(`${value}T12:00:00Z`).getUTCDay()
  return shiftDay(value, -(weekday + 6) % 7)
}

export function overlapSummary(leaves: OccupancyLeave[], start: string, end: string, excludeId?: number) {
  if (!validDay(start) || !validDay(end) || start > end) return null
  const matches = leaves.filter((leave) =>
    leave.id !== excludeId && leave.status !== "rejected" &&
    validDay(dayKey(leave.startDate)) && validDay(dayKey(leave.endDate)) &&
    dayKey(leave.startDate) <= end && dayKey(leave.endDate) >= start
  )
  const people = (status: "approved" | "pending") => {
    const unique = new Map<number, string>()
    for (const leave of matches) if (leave.status === status) unique.set(leave.employeeId, leave.employeeName)
    return Array.from(unique, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "tr"))
  }
  const approved = people("approved")
  const pending = people("pending")
  return { approved, pending, distinctPeople: new Set([...approved, ...pending].map(person => person.id)).size, matches: matches.sort((a, b) => a.employeeName.localeCompare(b.employeeName, "tr") || a.id - b.id) }
}

export function dayOccupancy(leaves: OccupancyLeave[], date: string) {
  return overlapSummary(leaves, date, date)!
}

// Mirrors the server's hard annual-leave limit; acknowledgment cannot override it.
export function annualCapacityConflict(
  leaves: (OccupancyLeave & Pick<Leave, "type">)[], start: string, end: string, employeeId: number, excludeId?: number,
): string | null {
  if (!validDay(start) || !validDay(end) || start > end) return null
  const approved = leaves.filter(leave =>
    leave.type === "annual" && leave.status === "approved" &&
    leave.employeeId !== employeeId && leave.id !== excludeId &&
    dayKey(leave.startDate) <= end && dayKey(leave.endDate) >= start,
  )
  let first: string | null = null
  for (let i = 0; i < approved.length; i++) {
    for (let j = i + 1; j < approved.length; j++) {
      const a = approved[i], b = approved[j]
      if (a.employeeId === b.employeeId) continue
      const from = [start, dayKey(a.startDate), dayKey(b.startDate)].sort().at(-1)!
      const to = [end, dayKey(a.endDate), dayKey(b.endDate)].sort()[0]
      if (from <= to && (!first || from < first)) first = from
    }
  }
  return first
}

export function formatDay(value: string, options: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }): string {
  return new Intl.DateTimeFormat("tr-TR", { ...options, timeZone: "UTC" }).format(new Date(`${dayKey(value)}T12:00:00Z`))
}