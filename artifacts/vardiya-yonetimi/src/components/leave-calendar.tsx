import { useId, useMemo, useState } from "react"
import { getListCalendarEventsQueryKey, useListCalendarEvents, type CalendarEvent, type Leave } from "@workspace/api-client-react"
import { CalendarDays, Plus, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { hasOperationalAccess, useAuth } from "@/lib/auth"
import { CalendarEventEditor } from "@/components/calendar-event-editor"
import { CalendarNearbyList } from "@/components/calendar-nearby-list"
import { eventsOnDay, inclusiveDays, type CalendarFocus } from "@/lib/calendar-events"
import { dayOccupancy, dayNumber, formatDay, fromDayNumber, shiftDay, todayInIstanbul, weekStart } from "@/lib/leave-occupancy"

type View = "week" | "month" | "year"
const weekDays = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"]
const monthFormat = { month: "long", year: "numeric" } satisfies Intl.DateTimeFormatOptions

function monthDays(year: number, month: number): string[] {
  const first = `${year}-${String(month).padStart(2, "0")}-01`
  const start = weekStart(first)
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const end = `${year}-${String(month).padStart(2, "0")}-${String(last).padStart(2, "0")}`
  const count = Math.round((dayNumber(end) - dayNumber(start)) / 86400000) + 1
  return Array.from({ length: Math.ceil(count / 7) * 7 }, (_, i) => shiftDay(start, i))
}

function DateCell({ date, leaves, events, focus, compact = false, outside = false, today, onSelect }: { date: string; leaves: Leave[]; events: CalendarEvent[]; focus?: CalendarFocus; compact?: boolean; outside?: boolean; today: string; onSelect: (date: string) => void }) {
  const summary = dayOccupancy(leaves, date)
  const dayEvents = eventsOnDay(events, date)
  const inFocus = !!focus && date >= focus.start && date <= focus.end
  const names = (status: "approved" | "pending") => summary[status].map(p => p.name)
  return <button type="button" onClick={() => onSelect(date)} data-testid={`calendar-day-${date}`} aria-label={`${formatDay(date)} ayrıntıları. Onaylı izinde ${summary.approved.length} kişi: ${names("approved").join(", ") || "yok"}. Bekleyen ${summary.pending.length} kişi: ${names("pending").join(", ") || "yok"}.${dayEvents.length ? ` Etkinlik: ${dayEvents.map(e => e.title).join(", ")}.` : ""}${inFocus ? ` İncelenen talep aralığında: ${focus!.employeeName}.` : ""}`} className={`min-w-0 border-r border-b border-border/70 p-1.5 text-left transition-colors hover:bg-secondary/40 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary sm:p-2 ${compact ? "min-h-[74px]" : "min-h-[106px] sm:min-h-[124px]"} ${outside ? "bg-muted/15 opacity-55" : "bg-card"} ${date === today ? "ring-1 ring-inset ring-primary/50" : ""} ${inFocus ? "!bg-primary/15 shadow-[inset_0_3px_0_0_hsl(var(--primary))]" : ""}`} data-focus-range={inFocus ? "true" : undefined}>
    <div className="flex items-center justify-between gap-1">
      <span className={`inline-flex h-6 min-w-6 items-center justify-center rounded-md text-xs font-semibold tabular-nums ${date === today ? "bg-primary text-primary-foreground" : "text-foreground"}`}>{Number(date.slice(8, 10))}</span>
      {summary.approved.length > 0 && <span className="rounded bg-primary/10 px-1 py-0.5 text-[10px] font-bold leading-none text-primary" aria-label={`${summary.approved.length} kişi onaylı izinde`}>{summary.approved.length} izinli</span>}
    </div>
    <div className="mt-1 space-y-0.5">
      {inFocus && <p className="truncate rounded-sm bg-primary px-1 text-[10px] font-bold leading-4 text-primary-foreground" title={`${focus!.employeeName}: ${formatDay(focus!.start)} – ${formatDay(focus!.end)}`} data-testid={`marker-focus-${date}`}>{date === focus!.start || compact ? `Talep · ${focus!.employeeName}` : "Talep"}</p>}
      {dayEvents.map(e => <p key={e.id} className="line-clamp-2 break-words rounded-sm border-l-2 border-sky-600 bg-sky-500/10 px-1 text-[10px] leading-4 text-foreground" title={e.title} data-testid={`marker-event-${e.id}-${date}`}>Etkinlik · {e.title}</p>)}
      {summary.approved.length > 0 && <p className="line-clamp-2 break-words rounded-sm border-l-2 border-primary bg-primary/5 px-1 text-[10px] font-medium leading-4 text-foreground" title={names("approved").join(", ")}>{names("approved").join(", ")}</p>}
      {summary.pending.length > 0 && <p className="line-clamp-2 break-words rounded-sm border-l-2 border-amber-500 bg-amber-500/10 px-1 text-[10px] leading-4 text-foreground" title={names("pending").join(", ")}>{summary.pending.length} başvuru · {names("pending").join(", ")}</p>}
    </div>
  </button>
}

export function LeaveCalendar({ leaves, loading, error, onRetry, focus }: { leaves: Leave[]; loading: boolean; error: boolean; onRetry: () => void; focus?: CalendarFocus }) {
  const uid = useId().replace(/:/g, "")
  const { user } = useAuth()
  const canEdit = hasOperationalAccess(user?.role)
  const eventsQuery = useListCalendarEvents({ query: { queryKey: getListCalendarEventsQueryKey(), staleTime: 30_000, refetchOnWindowFocus: true } })
  const events = useMemo(() => eventsQuery.data ?? [], [eventsQuery.data])
  const [editing, setEditing] = useState<CalendarEvent | "new" | null>(null)
  const [view, setView] = useState<View>("month")
  const [anchor, setAnchor] = useState(() => focus?.start ?? todayInIstanbul())
  const [expanded, setExpanded] = useState(true)
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const selectedEvents = selectedDay ? eventsOnDay(events, selectedDay) : []
  const selectedSummary = selectedDay ? dayOccupancy(leaves, selectedDay) : null
  const today = todayInIstanbul()
  const year = Number(anchor.slice(0, 4))
  const month = Number(anchor.slice(5, 7))
  const title = view === "year" ? `${year}` : view === "week"
    ? `${formatDay(weekStart(anchor))} – ${formatDay(shiftDay(weekStart(anchor), 6))}`
    : formatDay(`${anchor.slice(0, 7)}-01`, monthFormat)
  const week = useMemo(() => Array.from({ length: 7 }, (_, i) => shiftDay(weekStart(anchor), i)), [anchor])
  const monthGrid = useMemo(() => monthDays(year, month), [year, month])
  function navigate(amount: number) {
    if (view === "week") setAnchor(shiftDay(anchor, amount * 7))
    else if (view === "month") {
      const date = new Date(Date.UTC(year, month - 1 + amount, 1))
      setAnchor(fromDayNumber(date.getTime() + 12 * 3600000))
    } else {
      const targetYear = year + amount
      const lastDay = new Date(Date.UTC(targetYear, month, 0)).getUTCDate()
      const day = Math.min(Number(anchor.slice(8, 10)), lastDay)
      setAnchor(`${targetYear}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`)
    }
  }
  function grid(dates: string[], compact = false, currentMonth?: string) {
    return <div className="overflow-x-auto rounded-lg"><div className="grid min-w-[630px] grid-cols-7 overflow-hidden rounded-lg border-l border-t border-border/70">
      {weekDays.map(day => <div key={day} className="border-r border-b border-border/70 bg-muted/35 px-1 py-2 text-center text-[10px] font-bold uppercase tracking-wide text-muted-foreground sm:text-xs">{day}</div>)}
      {dates.map(date => <DateCell key={date} date={date} leaves={leaves} events={events} focus={focus} compact={compact} outside={!!currentMonth && !date.startsWith(currentMonth)} today={today} onSelect={setSelectedDay} />)}
    </div></div>
  }
  return <section className="overflow-hidden rounded-xl border bg-card shadow-sm" aria-labelledby={`${uid}-title`}>
    <Dialog open={selectedDay !== null} onOpenChange={open => { if (!open) setSelectedDay(null) }}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader><DialogTitle>{selectedDay ? formatDay(selectedDay, { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : "Gün ayrıntıları"}</DialogTitle></DialogHeader>
        {selectedSummary && <div className="space-y-4 text-sm" data-testid="status-calendar-day-details">
          <p className="text-muted-foreground">Bu gün için çalışan bazında tekil kişi sayıları. Bekleyen başvurular henüz izinli sayılmaz.</p>
          <section className="rounded-lg border border-primary/20 bg-primary/5 p-4">
            <h3 className="font-semibold text-primary">Onaylı izin · {selectedSummary.approved.length} kişi</h3>
            {selectedSummary.approved.length ? <ul className="mt-2 space-y-1.5">{selectedSummary.approved.map(person => <li key={person.id} className="font-medium" data-testid={`text-calendar-approved-${person.id}`}>{person.name} <span className="font-normal text-muted-foreground">· İzinde</span></li>)}</ul> : <p className="mt-2 text-muted-foreground">Onaylı izin yok.</p>}
          </section>
          <section className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4">
            <h3 className="font-semibold text-amber-700 dark:text-amber-300">Bekleyen başvuru · {selectedSummary.pending.length} kişi</h3>
            {selectedSummary.pending.length ? <ul className="mt-2 space-y-1.5">{selectedSummary.pending.map(person => <li key={person.id} className="font-medium" data-testid={`text-calendar-pending-${person.id}`}>{person.name} <span className="font-normal text-muted-foreground">· Henüz izinde değil</span></li>)}</ul> : <p className="mt-2 text-muted-foreground">Bekleyen başvuru yok.</p>}
          </section>
          <section className="rounded-lg border border-sky-600/20 bg-sky-500/5 p-4" data-testid="section-calendar-day-events">
            <h3 className="font-semibold text-sky-700 dark:text-sky-300">Etkinlikler · {selectedEvents.length}</h3>
            {selectedEvents.length ? <ul className="mt-2 space-y-2">{selectedEvents.map(e => <li key={e.id}><p className="font-medium">{e.title}</p><p className="text-xs text-muted-foreground">{e.startDate.slice(0, 10) === e.endDate.slice(0, 10) ? formatDay(e.startDate) : `${formatDay(e.startDate)} – ${formatDay(e.endDate)}`}{e.createdByName ? ` · ${e.createdByName}` : ""}</p>{e.description && <p className="mt-1 whitespace-pre-wrap break-words text-xs">{e.description}</p>}{canEdit && <Button type="button" variant="ghost" size="sm" className="mt-1 h-6 px-2 text-xs" onClick={() => { setSelectedDay(null); setEditing(e) }} data-testid={`button-edit-day-event-${e.id}`}>Düzenle</Button>}</li>)}</ul> : <p className="mt-2 text-muted-foreground">Etkinlik yok.</p>}
            {canEdit && <Button type="button" variant="outline" size="sm" className="mt-3 gap-1" onClick={() => { setEditing("new") }} data-testid="button-add-day-event"><Plus className="h-3.5 w-3.5" />Bu güne etkinlik ekle</Button>}
          </section>
          <p className="text-xs text-muted-foreground">Toplam {selectedSummary.distinctPeople} farklı kişi. Bir kişinin birden çok kaydı olsa bile her durumda bir kez sayılır.</p>
        </div>}
      </DialogContent>
    </Dialog>
    <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/20 px-4 py-4 sm:px-5">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary text-primary"><CalendarDays className="h-5 w-5" /></div>
        <div><h2 id={`${uid}-title`} className="font-semibold">İzin takvimi</h2><p className="text-xs text-muted-foreground">Onaylı izinler ve bekleyen başvurular, ayrı gösterilir</p></div>
      </div>
      <div className="flex items-center gap-1">
      {canEdit && <Button type="button" variant="outline" size="sm" className="gap-1" onClick={() => setEditing("new")} data-testid="button-add-calendar-event"><Plus className="h-4 w-4" />Etkinlik ekle</Button>}
      <Button type="button" variant="ghost" size="sm" aria-expanded={expanded} aria-controls={`${uid}-content`} onClick={() => setExpanded(!expanded)} data-testid="button-toggle-leave-calendar" className="gap-1">{expanded ? "Daralt" : "Genişlet"}<ChevronDown className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`} /></Button>
      </div>
    </div>
    {expanded && <div id={`${uid}-content`} className="px-3 pb-4 pt-3 sm:px-5 sm:pb-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Button type="button" size="icon" variant="outline" className="h-8 w-8" aria-label="Önceki dönem" data-testid="button-calendar-previous" onClick={() => navigate(-1)}><ChevronLeft className="h-4 w-4" /></Button>
          <Button type="button" size="icon" variant="outline" className="h-8 w-8" aria-label="Sonraki dönem" data-testid="button-calendar-next" onClick={() => navigate(1)}><ChevronRight className="h-4 w-4" /></Button>
          <Button type="button" size="sm" variant="outline" className="ml-1 h-8" data-testid="button-calendar-today" onClick={() => setAnchor(todayInIstanbul())}>Bugün</Button>
          {focus && <Button type="button" size="sm" variant="outline" className="h-8" data-testid="button-calendar-focus" onClick={() => setAnchor(focus.start)}>Talebe dön</Button>}
          <span className="ml-2 text-sm font-bold capitalize text-foreground sm:text-base" data-testid="text-calendar-period">{title}</span>
        </div>
        <div role="group" aria-label="Takvim görünümü" className="inline-flex rounded-lg border bg-muted/30 p-0.5">
          {([["week", "Hafta"], ["month", "Ay"], ["year", "Yıl"]] as const).map(([key, label]) => <Button key={key} type="button" size="sm" variant={view === key ? "secondary" : "ghost"} aria-pressed={view === key} className="h-7 px-3 text-xs" data-testid={`button-calendar-${key}`} onClick={() => setView(key)}>{label}</Button>)}
        </div>
      </div>
      {focus && <div className="mb-3 rounded-lg border-l-4 border-primary bg-primary/10 p-3 text-sm" data-testid="banner-calendar-focus"><p className="font-semibold">İncelenen talep: {focus.employeeName}</p><p className="text-xs text-muted-foreground">{formatDay(focus.start)} – {formatDay(focus.end)} · {inclusiveDays(focus.start, focus.end)} gün (bitiş dahil). Takvimde dolu renkle işaretli günlerin tamamı bu talebe aittir.</p></div>}
      {eventsQuery.isError && <p role="alert" className="mb-3 rounded-lg border border-destructive/30 p-3 text-sm">Etkinlikler alınamadı. <Button type="button" variant="outline" size="sm" onClick={() => void eventsQuery.refetch()} data-testid="button-retry-calendar-events">Yeniden dene</Button></p>}
      {eventsQuery.isLoading && <p role="status" className="mb-3 text-xs text-muted-foreground">Etkinlikler yükleniyor…</p>}
      {!eventsQuery.isLoading && !eventsQuery.isError && events.length === 0 && <p className="mb-3 text-xs text-muted-foreground" data-testid="text-calendar-no-events">Henüz takvim etkinliği yok.</p>}
      <div className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground"><span><i className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm bg-primary align-middle" />Onaylı · gerçekten izinde</span><span><i className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm bg-amber-500 align-middle" />Bekleyen · henüz izinde değil</span><span><i className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm bg-sky-600 align-middle" />Etkinlik · bilgilendirme</span>{focus && <span><i className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm bg-primary/40 align-middle" />İncelenen talep</span>}<span>Her gün kişi bazında tekil sayılır</span></div>
      {loading ? <div role="status" className="grid grid-cols-7 gap-1">{Array.from({ length: 28 }, (_, i) => <div key={i} className="h-20 animate-pulse rounded bg-muted/60" />)}<span className="sr-only">Takvim yükleniyor</span></div>
        : error ? <div role="alert" className="rounded-lg border border-destructive/30 p-5 text-sm">Takvim verileri alınamadı. <Button type="button" variant="outline" size="sm" onClick={onRetry}>Yeniden dene</Button></div>
        : view === "week" ? grid(week)
          : view === "month" ? grid(monthGrid, false, anchor.slice(0, 7))
            : <div className="grid gap-5 xl:grid-cols-2">{Array.from({ length: 12 }, (_, i) => <section key={i}><h3 className="mb-2 text-sm font-semibold capitalize">{formatDay(`${year}-${String(i + 1).padStart(2, "0")}-01`, { month: "long" })}</h3>{grid(monthDays(year, i + 1), true, `${year}-${String(i + 1).padStart(2, "0")}`)}</section>)}</div>}
      {focus && !loading && !error && eventsQuery.isSuccess && <div className="mt-4"><CalendarNearbyList focus={focus} leaves={leaves} events={events} canEdit={canEdit} onEdit={setEditing} /></div>}
    </div>}
    <CalendarEventEditor open={editing !== null} onOpenChange={o => { if (!o) setEditing(null) }} event={editing && editing !== "new" ? editing : null} defaultDate={selectedDay ?? focus?.start ?? anchor} idPrefix={uid} />
  </section>
}