export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000-")) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function calendarEventDateError(start: unknown, end: unknown): string | null {
  if (!isCalendarDate(start) || !isCalendarDate(end)) return "Etkinlik için geçerli başlangıç ve bitiş tarihleri seçin.";
  if (end < start) return "Etkinliğin bitiş tarihi başlangıç tarihinden önce olamaz.";
  return null;
}
