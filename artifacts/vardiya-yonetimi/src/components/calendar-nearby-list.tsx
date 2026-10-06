import type { CalendarEvent, Leave } from "@workspace/api-client-react"
import { Button } from "@/components/ui/button"
import { formatDay } from "@/lib/leave-occupancy"
import { NEAR_DAYS, nearbyItems, type CalendarFocus } from "@/lib/calendar-events"

const range = (s: string, e: string) => s === e ? formatDay(s) : `${formatDay(s)} – ${formatDay(e)}`
const statusLabel = (s: string) => s === "approved" ? "Onaylı izin" : "Bekleyen başvuru"

export function CalendarNearbyList({ focus, leaves, events, canEdit, onEdit }: { focus: CalendarFocus; leaves: Leave[]; events: CalendarEvent[]; canEdit: boolean; onEdit: (event: CalendarEvent) => void }) {
  const near = nearbyItems(focus, leaves, events)
  const empty = !near.leaves.length && !near.events.length
  const badge = (kind: "overlap" | "near") => <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${kind === "overlap" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"}`}>{kind === "overlap" ? "Talep günleriyle çakışıyor" : "Yakın tarih"}</span>
  return <section className="rounded-lg border bg-muted/10 p-3 text-sm" data-testid="section-calendar-nearby" aria-label="Yakındaki izinler ve etkinlikler">
    <h3 className="font-semibold">Yakındaki izinler ve etkinlikler</h3>
    <p className="mt-1 text-xs text-muted-foreground" data-testid="text-calendar-near-window">Yakın: talebin başlangıcından {NEAR_DAYS} takvim günü öncesi ile bitişinden {NEAR_DAYS} takvim günü sonrası arası ({formatDay(near.from)} – {formatDay(near.to)}). Talep günleriyle kesişenler ayrıca işaretlenir.</p>
    {empty ? <p className="mt-3 text-muted-foreground" data-testid="text-calendar-near-empty">Bu aralıkta başka izin veya etkinlik yok.</p> : <div className="mt-3 grid gap-4 md:grid-cols-2">
      <div><h4 className="mb-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">Diğer izinler ({near.leaves.length})</h4>
        {near.leaves.length ? <ul className="space-y-1.5">{near.leaves.map(({ leave, start, end, kind }) => <li key={leave.id} className="rounded-md border bg-card p-2" data-testid={`row-nearby-leave-${leave.id}`}>
          <p className="font-medium">{leave.employeeName}</p><p className="text-xs text-muted-foreground">{range(start, end)} · {statusLabel(leave.status)}</p><div className="mt-1">{badge(kind)}</div></li>)}</ul> : <p className="text-xs text-muted-foreground">Yok.</p>}</div>
      <div><h4 className="mb-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">Etkinlikler ({near.events.length})</h4>
        {near.events.length ? <ul className="space-y-1.5">{near.events.map(({ event, start, end, kind }) => <li key={event.id} className="rounded-md border bg-card p-2" data-testid={`row-nearby-event-${event.id}`}>
          <p className="font-medium">{event.title}</p><p className="text-xs text-muted-foreground">{range(start, end)}{event.createdByName ? ` · ${event.createdByName}` : ""}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">{badge(kind)}{canEdit && <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => onEdit(event)} data-testid={`button-edit-nearby-event-${event.id}`}>Düzenle</Button>}</div></li>)}</ul> : <p className="text-xs text-muted-foreground">Yok.</p>}</div>
    </div>}
  </section>
}
