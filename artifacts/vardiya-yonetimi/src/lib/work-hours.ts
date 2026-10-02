/** Schedule duration already accounts for breaks; only subtract late arrival and early departure. */
export function hoursFromTimes(
  plannedHours: number,
  plannedStart: string | null | undefined,
  plannedEnd: string | null | undefined,
  checkIn: string | null | undefined,
  checkOut: string | null | undefined,
): number {
  const minutes = (value: string) => {
    const [hour, minute] = value.split(":").map(Number)
    return hour * 60 + minute
  }
  const late = plannedStart && checkIn ? Math.max(0, minutes(checkIn) - minutes(plannedStart)) : 0
  const early = plannedEnd && checkOut ? Math.max(0, minutes(plannedEnd) - minutes(checkOut)) : 0
  return Math.round(Math.max(0, plannedHours - (late + early) / 60) * 100) / 100
}