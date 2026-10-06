import { useEffect, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { getListCalendarEventsQueryKey, useCreateCalendarEvent, useDeleteCalendarEvent, useUpdateCalendarEvent, type CalendarEvent } from "@workspace/api-client-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useToast } from "@/hooks/use-toast"
import { dayKey } from "@/lib/leave-occupancy"
import { validateEventInput } from "@/lib/calendar-events"

type Props = { open: boolean; onOpenChange: (open: boolean) => void; event: CalendarEvent | null; defaultDate: string; idPrefix: string }
type Errors = ReturnType<typeof validateEventInput> extends infer R ? R extends { ok: false; errors: infer E } ? E : never : never

export function CalendarEventEditor({ open, onOpenChange, event, defaultDate, idPrefix }: Props) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const create = useCreateCalendarEvent()
  const update = useUpdateCalendarEvent()
  const remove = useDeleteCalendarEvent()
  const [fields, setFields] = useState({ title: "", description: "", startDate: defaultDate, endDate: defaultDate })
  const [errors, setErrors] = useState<Errors>({})
  const [serverError, setServerError] = useState("")
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const busy = submitting || create.isPending || update.isPending || remove.isPending

  useEffect(() => {
    if (!open) return
    setFields(event
      ? { title: event.title, description: event.description ?? "", startDate: dayKey(event.startDate), endDate: dayKey(event.endDate) }
      : { title: "", description: "", startDate: defaultDate, endDate: defaultDate })
    setErrors({}); setServerError(""); setConfirmDelete(false)
  }, [open, event, defaultDate])

  const refresh = () => queryClient.invalidateQueries({ queryKey: getListCalendarEventsQueryKey() })
  const set = (key: keyof typeof fields, value: string) => { setFields(f => ({ ...f, [key]: value })); setServerError("") }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    const result = validateEventInput(fields)
    if (!result.ok) { setErrors(result.errors); return }
    setErrors({}); setServerError("")
    setSubmitting(true)
    try {
      if (event) await update.mutateAsync({ id: event.id, data: result.input })
      else await create.mutateAsync({ data: result.input })
      await refresh()
      toast({ title: event ? "Etkinlik güncellendi" : "Etkinlik eklendi" })
      onOpenChange(false)
    } catch (error) {
      setServerError(error instanceof Error ? error.message : "Etkinlik kaydedilemedi.")
    } finally {
      setSubmitting(false)
    }
  }

  async function doDelete() {
    if (!event || busy) return
    setServerError("")
    setSubmitting(true)
    try {
      await remove.mutateAsync({ id: event.id })
      await refresh()
      toast({ title: "Etkinlik silindi" })
      onOpenChange(false)
    } catch (error) {
      setServerError(error instanceof Error ? error.message : "Etkinlik silinemedi.")
    } finally {
      setSubmitting(false)
    }
  }

  const err = (key: keyof Errors) => errors[key] ? <p role="alert" className="mt-1 text-xs text-destructive" data-testid={`error-${idPrefix}-event-${key}`}>{errors[key]}</p> : null
  return <Dialog open={open} onOpenChange={o => { if (!busy) onOpenChange(o) }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{event ? "Etkinliği düzenle" : "Takvime etkinlik ekle"}</DialogTitle>
        <DialogDescription>Etkinlikler yalnızca bilgilendiricidir; izin bakiyesini, iki kişi sınırını veya vardiyaları değiştirmez.</DialogDescription>
      </DialogHeader>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <fieldset disabled={busy} className="space-y-4">
          <div>
            <label htmlFor={`${idPrefix}-event-title`} className="text-sm font-medium">Başlık</label>
            <Input id={`${idPrefix}-event-title`} value={fields.title} maxLength={160} onChange={e => set("title", e.target.value)} data-testid="input-calendar-event-title" />
            {err("title")}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor={`${idPrefix}-event-start`} className="text-sm font-medium">Başlangıç</label>
              <Input id={`${idPrefix}-event-start`} type="date" value={fields.startDate} onChange={e => { const v = e.target.value; setFields(f => ({ ...f, startDate: v, endDate: !f.endDate || f.endDate < v ? v : f.endDate })); setServerError("") }} data-testid="input-calendar-event-start" />
              {err("startDate")}
            </div>
            <div>
              <label htmlFor={`${idPrefix}-event-end`} className="text-sm font-medium">Bitiş (dahil)</label>
              <Input id={`${idPrefix}-event-end`} type="date" value={fields.endDate} min={fields.startDate || undefined} onChange={e => set("endDate", e.target.value)} data-testid="input-calendar-event-end" />
              {err("endDate")}
            </div>
          </div>
          <p className="-mt-2 text-xs text-muted-foreground">Tek günlük etkinlik için iki tarihi aynı bırakın.</p>
          <div>
            <label htmlFor={`${idPrefix}-event-desc`} className="text-sm font-medium">Açıklama (isteğe bağlı)</label>
            <Textarea id={`${idPrefix}-event-desc`} value={fields.description} maxLength={2000} rows={3} onChange={e => set("description", e.target.value)} data-testid="input-calendar-event-description" />
            {err("description")}
          </div>
        </fieldset>
        {serverError && <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive" data-testid="alert-calendar-event-server">{serverError}</p>}
        {confirmDelete && event && <div role="alertdialog" aria-label="Silme onayı" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <p><strong>{event.title}</strong> etkinliği kalıcı olarak silinsin mi?</p>
          <div className="mt-3 flex gap-2">
            <Button type="button" size="sm" variant="destructive" disabled={busy} onClick={doDelete} data-testid="button-confirm-delete-calendar-event">{remove.isPending ? "Siliniyor…" : "Evet, sil"}</Button>
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setConfirmDelete(false)} data-testid="button-cancel-delete-calendar-event">Vazgeç</Button>
          </div>
        </div>}
        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          {event ? <Button type="button" variant="outline" disabled={busy || confirmDelete} onClick={() => setConfirmDelete(true)} className="border-destructive/40 text-destructive" data-testid="button-delete-calendar-event">Sil</Button> : <span />}
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)} data-testid="button-cancel-calendar-event">Vazgeç</Button>
            <Button type="submit" disabled={busy} data-testid="button-save-calendar-event">{create.isPending || update.isPending ? "Kaydediliyor…" : event ? "Değişiklikleri kaydet" : "Etkinlik ekle"}</Button>
          </div>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
}
