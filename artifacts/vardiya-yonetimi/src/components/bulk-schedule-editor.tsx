import { useState } from "react"
import type { ScheduleDay } from "@workspace/api-client-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"

type Props = {
  days: ScheduleDay[]
  onApply: (weekdays: number[], values: { hours: number; plannedStart: string | null; plannedEnd: string | null }) => void
  onCancel: () => void
}

function hoursBetween(start: string, end: string) {
  const [startHour, startMinute] = start.split(":").map(Number)
  const [endHour, endMinute] = end.split(":").map(Number)
  let minutes = (endHour * 60 + endMinute) - (startHour * 60 + startMinute)
  if (minutes < 0) minutes += 24 * 60
  return Math.round(minutes / 60 * 100) / 100
}

export function BulkScheduleEditor({ days, onApply, onCancel }: Props) {
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5])
  const [start, setStart] = useState("")
  const [end, setEnd] = useState("")
  const [hours, setHours] = useState("")
  const parsedHours = Number(hours)
  const valid = weekdays.length > 0 && hours.trim() !== "" && Number.isFinite(parsedHours)
    && parsedHours >= 0 && parsedHours <= 24 && (!start && !end || !!start && !!end)

  return (
    <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-4" data-testid="bulk-schedule-editor">
      <div>
        <h4 className="font-semibold text-sm">Birden fazla güne uygula</h4>
        <p className="text-xs text-muted-foreground mt-1">Günleri ve ortak saatleri seçin. Önce taslağa uygulanır; kalıcı olması için planı kaydedin.</p>
      </div>
      <fieldset className="space-y-2">
        <legend className="text-xs font-semibold mb-2">Uygulanacak günler</legend>
        <div className="flex flex-wrap gap-2">
          {days.map(day => (
            <label key={day.weekday} className="flex items-center gap-2 rounded-lg border bg-background px-3 py-2 text-sm cursor-pointer">
              <Checkbox
                checked={weekdays.includes(day.weekday)}
                onCheckedChange={checked => setWeekdays(current =>
                  checked === true ? [...current, day.weekday] : current.filter(value => value !== day.weekday)
                )}
              />
              {day.dayName}
            </label>
          ))}
        </div>
        <div className="flex gap-3">
          <button type="button" className="text-xs text-primary hover:underline" onClick={() => setWeekdays(days.filter(day => day.weekday <= 5).map(day => day.weekday))}>Hafta içi</button>
          <button type="button" className="text-xs text-primary hover:underline" onClick={() => setWeekdays(days.map(day => day.weekday))}>Tüm günler</button>
          <button type="button" className="text-xs text-muted-foreground hover:underline" onClick={() => setWeekdays([])}>Temizle</button>
        </div>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="space-y-1 text-xs font-medium">Başlangıç
          <Input aria-label="Toplu başlangıç" type="time" value={start} onChange={event => {
            const value = event.target.value
            setStart(value)
            if (value && end) setHours(String(hoursBetween(value, end)))
          }} className="bg-background" />
        </label>
        <label className="space-y-1 text-xs font-medium">Bitiş
          <Input aria-label="Toplu bitiş" type="time" value={end} onChange={event => {
            const value = event.target.value
            setEnd(value)
            if (start && value) setHours(String(hoursBetween(start, value)))
          }} className="bg-background" />
        </label>
        <label className="space-y-1 text-xs font-medium">Süre (saat)
          <Input aria-label="Toplu süre" type="number" min={0} max={24} step="any" value={hours}
            onChange={event => setHours(event.target.value)} placeholder="Örn: 8" className="bg-background" />
        </label>
      </div>
      <p className="text-xs text-muted-foreground">
        Başlangıç ve bitiş boş bırakılırsa yalnızca süre değişir, mevcut giriş/çıkış saatleri korunur. 0 saat girilirse seçili günlerin saatleri temizlenir.
      </p>
      {(!!start !== !!end) && <p role="alert" className="text-xs text-destructive">Başlangıç ve bitiş saatini birlikte girin.</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>Vazgeç</Button>
        <Button type="button" disabled={!valid} onClick={() => onApply(weekdays, {
          hours: parsedHours,
          plannedStart: start || null,
          plannedEnd: end || null,
        })} data-testid="button-apply-bulk-schedule">Seçili günlere uygula</Button>
      </div>
    </div>
  )
}