import type { Leave } from "@workspace/api-client-react"
import { Badge } from "@/components/ui/badge"

export function LeaveEntryBadge({ leave }: { leave: Leave }) {
  if (!leave.isLateEntry) return null
  const recorded = leave.recordedAt
    ? new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Istanbul" }).format(new Date(leave.recordedAt))
    : null
  const details = [leave.recordedByName, recorded].filter(Boolean).join(" · ")
  return (
    <span className="mt-1 block">
      <Badge variant="secondary">Sonradan eklendi</Badge>
      {details && <span className="mt-1 block text-xs font-normal text-muted-foreground">{details}</span>}
    </span>
  )
}
