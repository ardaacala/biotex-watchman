import { useMemo, useState } from "react"
import { format, parseISO } from "date-fns"
import { tr } from "date-fns/locale"
import { useQueryClient } from "@tanstack/react-query"
import { CalendarClock, ChevronDown, Clock3, Plus, Search, Trash2, X } from "lucide-react"
import { useForm } from "react-hook-form"
import {
  getGetDashboardSummaryQueryKey, getListOvertimeQueryKey, getListWorkDebtsQueryKey,
  useCreateOvertime, useDeleteOvertime, useListDepartments, useListEmployees,
  useListOvertime, useSaveOvertimeHours,
  type OvertimeSession, type OvertimeParticipant, type OvertimeInput,
} from "@workspace/api-client-react"
import { Layout } from "@/components/layout"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { hasOperationalAccess, useAuth } from "@/lib/auth"
import { useToast } from "@/hooks/use-toast"

type ScheduleForm = {
  workDate: string
  departments: string[]
  employeeIds: number[]
  plannedStart: string
  plannedEnd: string
  note: string
}

const numberFormat = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 })
const hours = (value: number) => `${numberFormat.format(value)} sa`
const dateLabel = (value: string) => format(parseISO(value), "d MMMM yyyy, EEEE", { locale: tr })

function ParticipantRow({ participant, sessionId, editable, onSaved }: {
  participant: OvertimeParticipant
  sessionId: number
  editable: boolean
  onSaved: () => void
}) {
  const [draft, setDraft] = useState(participant.actualHours === null ? "" : String(participant.actualHours))
  const save = useSaveOvertimeHours()
  const { toast } = useToast()
  const parsed = draft.trim() === "" ? null : Number(draft)
  const valid = parsed === null || (Number.isFinite(parsed) && parsed >= 0 && parsed <= 24)
  const changed = valid && parsed !== participant.actualHours

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t border-border/70 px-4 py-3 first:border-t-0 sm:grid-cols-[minmax(0,1fr)_110px_120px] sm:px-5" data-testid={`row-overtime-participant-${sessionId}-${participant.employeeId}`}>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{participant.employeeName}</p>
        <p className="font-mono text-[11px] text-muted-foreground">{participant.employeeNumber}</p>
      </div>
      {editable ? (
        <div className="flex items-center gap-2">
          <Input
            aria-label={`${participant.employeeName} gerçekleşen fazla mesai saati`}
            data-testid={`input-actual-hours-${sessionId}-${participant.employeeId}`}
            className="h-9 w-20 text-right font-mono text-sm"
            type="number" min="0" max="24" step="0.25" placeholder="—"
            value={draft} onChange={(event) => setDraft(event.target.value)}
          />
          <span className="text-xs text-muted-foreground sm:hidden">sa</span>
        </div>
      ) : (
        <span className={`text-right font-mono text-sm ${participant.actualHours === null ? "text-muted-foreground" : "font-semibold text-foreground"}`}>
          {participant.actualHours === null ? "Kaydedilmedi" : hours(participant.actualHours)}
        </span>
      )}
      {editable && (
        <div className="col-span-2 flex items-center justify-end gap-2 sm:col-span-1">
          {!valid && <span className="text-xs text-destructive">0–24 sa</span>}
          <Button
            size="sm" variant={changed ? "default" : "outline"} className="h-8"
            data-testid={`button-save-hours-${sessionId}-${participant.employeeId}`}
            disabled={!changed || save.isPending}
            onClick={() => save.mutate({ id: sessionId, employeeId: participant.employeeId, data: { actualHours: parsed } }, {
              onSuccess: () => { onSaved(); toast({ title: "Gerçekleşen saat kaydedildi" }) },
              onError: (error) => toast({ title: "Saat kaydedilemedi", description: error.message, variant: "destructive" }),
            })}
          >{save.isPending ? "Kaydediliyor" : "Kaydet"}</Button>
        </div>
      )}
    </div>
  )
}

function SessionCard({ session, editable, onDelete, onSaved }: {
  session: OvertimeSession
  editable: boolean
  onDelete: (session: OvertimeSession) => void
  onSaved: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const recorded = session.participants.filter((person) => person.actualHours !== null).length
  return (
    <article className="overflow-hidden rounded-xl border border-border bg-card shadow-sm transition-shadow hover:shadow-md" data-testid={`card-overtime-${session.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-4 px-5 py-5 sm:px-6">
        <div className="flex min-w-0 items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-secondary text-primary"><CalendarClock className="h-5 w-5" /></div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-primary">{session.scope === "combined" ? "Birleşik katılım" : session.scope === "department" ? "Departman planı" : "Seçili personel"}</p>
            <h3 className="mt-1 text-base font-bold tracking-tight sm:text-lg">{dateLabel(session.workDate)}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{session.departments.length ? session.departments.join(", ") : "Seçili kişiler"} <span className="mx-1.5 text-border">/</span> {session.participants.length} personel</p>
          </div>
        </div>
        <div className="flex items-center gap-3 pl-[60px] sm:pl-0">
          <div className="text-right">
            <p className="font-mono text-lg font-bold tabular-nums">{session.plannedStart}–{session.plannedEnd}</p>
            <p className="text-xs text-muted-foreground">Planlanan {hours(session.plannedHours)}</p>
          </div>
          {editable && <Button size="icon" variant="ghost" className="text-muted-foreground hover:text-destructive" aria-label="Fazla mesai planını sil" data-testid={`button-delete-overtime-${session.id}`} onClick={() => onDelete(session)}><Trash2 className="h-4 w-4" /></Button>}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-muted/20 px-5 py-3 text-xs sm:px-6">
        <div className="flex items-center gap-3">
          <span className={`rounded-full px-2.5 py-1 font-semibold ${recorded === session.participants.length && recorded > 0 ? "bg-lime-100 text-lime-900" : "bg-secondary text-secondary-foreground"}`}>{recorded}/{session.participants.length} gerçekleşen saat girildi</span>
          <span className="hidden text-muted-foreground sm:inline">Oluşturan: {session.createdByName}</span>
        </div>
        <button type="button" data-testid={`button-toggle-overtime-${session.id}`} className="inline-flex items-center gap-1.5 font-semibold text-primary transition-opacity hover:opacity-70" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>
          {expanded ? "Detayı kapat" : "Katılımcıları göster"} <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} />
        </button>
      </div>
      {expanded && (
        <div>
          {session.note && <p className="border-t bg-secondary/30 px-5 py-3 text-sm text-secondary-foreground sm:px-6">{session.note}</p>}
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-t bg-muted/40 px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground sm:grid-cols-[minmax(0,1fr)_110px_120px] sm:px-5">
            <span>Personel</span><span>Gerçekleşen</span>{editable && <span className="hidden text-right sm:block">İşlem</span>}
          </div>
          {session.participants.map((person) => <ParticipantRow key={person.employeeId} participant={person} sessionId={session.id} editable={editable} onSaved={onSaved} />)}
          <p className="border-t bg-muted/20 px-5 py-3 text-xs leading-5 text-muted-foreground">Planlanan süre tek başına çalışma borcunu kapatmaz. Mahsup için her personelin gerçekleşen saatini kaydedin.</p>
        </div>
      )}
    </article>
  )
}

export default function OvertimePage() {
  const { user } = useAuth()
  const editable = hasOperationalAccess(user?.role)
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const { data: sessions = [], isLoading, isError, refetch } = useListOvertime()
  const { data: employees = [], isLoading: employeesLoading, isError: employeesError, refetch: refetchEmployees } = useListEmployees({ status: "active" })
  const { data: departments = [], isLoading: departmentsLoading, isError: departmentsError, refetch: refetchDepartments } = useListDepartments()
  const create = useCreateOvertime()
  const remove = useDeleteOvertime()
  const [open, setOpen] = useState(false)
  const [deleting, setDeleting] = useState<OvertimeSession | null>(null)
  const [search, setSearch] = useState("")
  const [employeeSearch, setEmployeeSearch] = useState("")
  const form = useForm<ScheduleForm>({
    defaultValues: { workDate: format(new Date(), "yyyy-MM-dd"), departments: [], employeeIds: [], plannedStart: "17:00", plannedEnd: "19:00", note: "" },
  })
  const selectedDepartments = form.watch("departments")
  const selectedExtras = form.watch("employeeIds")
  const departmentPeople = employees.filter(person => selectedDepartments.includes(person.department))
  const outsidePeople = employees.filter(person => !selectedDepartments.includes(person.department))
  const visibleEmployees = outsidePeople.filter(person => `${person.name} ${person.employeeNumber} ${person.department}`.toLocaleLowerCase("tr-TR").includes(employeeSearch.toLocaleLowerCase("tr-TR")))
  const selectedExtraPeople = outsidePeople.filter(person => selectedExtras.includes(person.id))
  const participantCount = departmentPeople.length + selectedExtraPeople.length
  const filtered = useMemo(() => sessions.filter((session) => `${session.departments.join(" ")} ${session.department || ""} ${session.workDate} ${session.participants.map((person) => person.employeeName).join(" ")}`.toLocaleLowerCase("tr-TR").includes(search.toLocaleLowerCase("tr-TR"))).sort((a, b) => b.workDate.localeCompare(a.workDate) || b.id - a.id), [sessions, search])
  const totalPeople = sessions.reduce((sum, session) => sum + session.participants.length, 0)
  const recordedPeople = sessions.reduce((sum, session) => sum + session.participants.filter((person) => person.actualHours !== null).length, 0)

  function refreshAffected() {
    void queryClient.invalidateQueries({ queryKey: getListOvertimeQueryKey() })
    void queryClient.invalidateQueries({ queryKey: getListWorkDebtsQueryKey() })
    void queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() })
  }

  function closeCreate() {
    if (create.isPending) return
    setOpen(false)
    form.reset()
    setEmployeeSearch("")
  }

  function submit(values: ScheduleForm) {
    if (!editable) return
    if (employeesError || departmentsError) {
      form.setError("employeeIds", { message: "Personel ve departman listesi yüklenemedi. Tekrar deneyin." }); return
    }
    const extras = values.employeeIds.filter(id => !values.departments.includes(employees.find(person => person.id === id)?.department ?? ""))
    const participantIds = new Set([
      ...employees.filter(person => values.departments.includes(person.department)).map(person => person.id),
      ...extras,
    ])
    if (!participantIds.size) {
      form.setError("employeeIds", { message: "En az bir aktif personeli olan departman veya ek personel seçin." }); return
    }
    if (values.plannedEnd <= values.plannedStart) {
      form.setError("plannedEnd", { message: "Bitiş saati başlangıçtan sonra olmalı." }); return
    }
    const data: OvertimeInput = {
      workDate: values.workDate,
      scope: "combined",
      departments: values.departments,
      employeeIds: extras,
      plannedStart: values.plannedStart, plannedEnd: values.plannedEnd,
      ...(values.note.trim() ? { note: values.note.trim() } : {}),
    }
    create.mutate({ data }, {
      onSuccess: () => {
        refreshAffected()
        setOpen(false)
        form.reset()
        setEmployeeSearch("")
        toast({ title: "Fazla mesai planlandı", description: "Gerçekleşen saatler ayrı olarak kaydedilmelidir." })
      },
      onError: (error) => toast({ title: "Plan oluşturulamadı", description: error.message, variant: "destructive" }),
    })
  }

  return (
    <Layout>
      <div className="flex-1 overflow-auto bg-background/60 px-4 py-6 sm:px-7 lg:px-10 lg:py-9">
        <div className="mx-auto max-w-6xl">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">Çalışma yönetimi / 01</p>
              <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">Fazla Mesai</h1>
              <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">Planı oluşturun, gerçekleşen süreleri kişi bazında kaydedin. Yalnızca kaydedilen saatler borç hesabına yansır.</p>
            </div>
            {editable && <Button onClick={() => setOpen(true)} className="gap-2 shadow-sm" data-testid="button-create-overtime"><Plus className="h-4 w-4" /> Yeni plan oluştur</Button>}
          </div>

          <div className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="rounded-xl border bg-card p-4 sm:p-5"><p className="text-xs font-semibold text-muted-foreground">Toplam plan</p><p className="mt-2 font-mono text-2xl font-bold tabular-nums" data-testid="text-overtime-session-count">{sessions.length}</p></div>
            <div className="rounded-xl border bg-card p-4 sm:p-5"><p className="text-xs font-semibold text-muted-foreground">Katılımcı kaydı</p><p className="mt-2 font-mono text-2xl font-bold tabular-nums">{totalPeople}</p></div>
            <div className="col-span-2 rounded-xl border border-primary/15 bg-secondary/60 p-4 sm:col-span-1 sm:p-5"><p className="text-xs font-semibold text-secondary-foreground">Saati girilen</p><p className="mt-2 font-mono text-2xl font-bold tabular-nums text-primary" data-testid="text-overtime-recorded-count">{recordedPeople}<span className="ml-1 text-sm font-medium text-muted-foreground">/ {totalPeople}</span></p></div>
          </div>

          <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
            <div><h2 className="text-base font-bold">Mesai planları</h2><p className="text-xs text-muted-foreground">Tarihe göre en yeniden eskiye</p></div>
            <div className="relative w-full sm:w-72"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input data-testid="input-search-overtime" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tarih, departman veya personel" className="h-9 bg-card pl-9" /></div>
          </div>
          <div className="mt-4 space-y-3">
            {isLoading ? [0, 1, 2].map((index) => <div key={index} className="h-36 animate-pulse rounded-xl border bg-muted/70" />) :
              isError ? <div className="rounded-xl border border-destructive/20 bg-card p-8 text-center"><p className="font-semibold">Mesai planları yüklenemedi.</p><Button variant="outline" className="mt-4" onClick={() => void refetch()}>Tekrar dene</Button></div> :
              filtered.length === 0 ? <div className="rounded-xl border border-dashed bg-card px-6 py-14 text-center"><Clock3 className="mx-auto h-8 w-8 text-primary/60" /><h3 className="mt-4 font-bold">{search ? "Aramanıza uygun plan yok" : "Henüz fazla mesai planı yok"}</h3><p className="mt-2 text-sm text-muted-foreground">{search ? "Başka bir isim, tarih veya departman deneyin." : "Yeni bir plan oluşturduğunuzda burada görünecek."}</p>{editable && !search && <Button variant="outline" className="mt-5" onClick={() => setOpen(true)}>İlk planı oluştur</Button>}</div> :
              filtered.map((session) => <SessionCard key={session.id} session={session} editable={editable} onDelete={setDeleting} onSaved={refreshAffected} />)}
          </div>
        </div>
      </div>

      {editable && <Dialog open={open} onOpenChange={next => { if (next) setOpen(true); else closeCreate() }}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader><DialogTitle>Yeni fazla mesai planı</DialogTitle><DialogDescription>Katılım kapsamını ve planlanan zaman aralığını belirleyin. Gerçekleşen saatler daha sonra girilir.</DialogDescription></DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(submit)} className="space-y-5 pt-2">
              <FormField control={form.control} name="workDate" rules={{ required: "Tarih gerekli." }} render={({ field }) => <FormItem><FormLabel>Çalışma tarihi</FormLabel><FormControl><Input type="date" data-testid="input-overtime-date" {...field} /></FormControl><FormMessage /></FormItem>} />
               <FormField control={form.control} name="departments" render={({ field }) => <FormItem>
                 <FormLabel>Departmanlar <span className="font-normal text-muted-foreground">({field.value.length} seçili)</span></FormLabel>
                 <p className="text-xs text-muted-foreground">Seçilen departmanların tüm aktif personeli plana katılır. Birden fazla seçebilirsiniz.</p>
                 <FormControl>
                   <div className="grid max-h-40 grid-cols-1 gap-2 overflow-y-auto rounded-lg border bg-background p-2 sm:grid-cols-2">
                     {departments.map(item => {
                       const count = employees.filter(person => person.department === item.name).length
                       return <label key={item.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-muted">
                         <input type="checkbox" data-testid={`checkbox-overtime-department-${item.id}`} className="h-4 w-4 shrink-0 accent-[hsl(var(--primary))]"
                           checked={field.value.includes(item.name)}
                           onChange={event => {
                             const next = event.target.checked ? [...field.value, item.name] : field.value.filter(name => name !== item.name)
                             field.onChange(next)
                             form.setValue("employeeIds", form.getValues("employeeIds").filter(id => !next.includes(employees.find(person => person.id === id)?.department ?? "")))
                             form.clearErrors("employeeIds")
                           }} />
                         <span className="min-w-0 flex-1 truncate font-medium">{item.name}</span>
                         <span className="text-xs text-muted-foreground">{count} kişi</span>
                       </label>
                     })}
                     {!departmentsLoading && departments.length === 0 && <p className="p-3 text-xs text-muted-foreground">Departman bulunamadı. Aşağıdan tek tek kişi seçebilirsiniz.</p>}
                   </div>
                 </FormControl>
                 {departmentsError && <button type="button" className="text-xs font-semibold text-destructive underline" onClick={() => void refetchDepartments()}>Departman listesi alınamadı. Tekrar dene</button>}
               </FormItem>} />
               <FormField control={form.control} name="employeeIds" render={({ field }) => <FormItem>
                 <FormLabel>Departman dışından ek kişiler <span className="font-normal text-muted-foreground">({selectedExtraPeople.length} seçili)</span></FormLabel>
                 <p className="text-xs text-muted-foreground">Seçtiğiniz departmanlardaki kişiler zaten ekli. Burada yalnızca diğer departmanlardan kişi seçin.</p>
                 <FormControl>
                   <div className="rounded-lg border bg-background">
                     <div className="relative border-b"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input data-testid="input-search-employees-overtime" className="border-0 pl-9 shadow-none" placeholder="İsim, sicil veya departman ara" value={employeeSearch} onChange={event => setEmployeeSearch(event.target.value)} /></div>
                     <div className="max-h-44 overflow-y-auto p-1">
                       {visibleEmployees.map(person => <label key={person.id} className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 hover:bg-muted">
                         <input type="checkbox" data-testid={`checkbox-overtime-employee-${person.id}`} className="h-4 w-4 shrink-0 accent-[hsl(var(--primary))]"
                           checked={field.value.includes(person.id)}
                           onChange={event => { field.onChange(event.target.checked ? [...field.value, person.id] : field.value.filter(id => id !== person.id)); form.clearErrors("employeeIds") }} />
                         <span className="min-w-0 flex-1 truncate text-sm font-medium">{person.name}</span>
                         <span className="hidden text-xs text-muted-foreground sm:block">{person.department}</span>
                         <span className="font-mono text-[11px] text-muted-foreground">{person.employeeNumber}</span>
                       </label>)}
                       {!employeesLoading && !visibleEmployees.length && <p className="p-4 text-center text-sm text-muted-foreground">{outsidePeople.length ? "Aramanıza uygun kişi bulunamadı." : "Eklenebilecek başka personel yok."}</p>}
                     </div>
                   </div>
                 </FormControl>
                 {selectedExtraPeople.length > 0 && <p className="text-xs text-muted-foreground">Eklenenler: {selectedExtraPeople.map(person => person.name).join(", ")}</p>}
                 <FormMessage />
                 {employeesError && <button type="button" className="text-xs font-semibold text-destructive underline" onClick={() => void refetchEmployees()}>Personel listesi alınamadı. Tekrar dene</button>}
               </FormItem>} />
               <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-sm font-semibold text-primary" data-testid="text-overtime-participant-preview">
                 {selectedDepartments.length} departman + {selectedExtraPeople.length} ek kişi · Toplam {participantCount} katılımcı
               </div>
              <div className="grid grid-cols-2 gap-3">
                <FormField control={form.control} name="plannedStart" rules={{ required: "Başlangıç gerekli." }} render={({ field }) => <FormItem><FormLabel>Başlangıç</FormLabel><FormControl><Input type="time" data-testid="input-overtime-start" {...field} /></FormControl><FormMessage /></FormItem>} />
                <FormField control={form.control} name="plannedEnd" rules={{ required: "Bitiş gerekli." }} render={({ field }) => <FormItem><FormLabel>Bitiş</FormLabel><FormControl><Input type="time" data-testid="input-overtime-end" {...field} /></FormControl><FormMessage /></FormItem>} />
              </div>
              <FormField control={form.control} name="note" render={({ field }) => <FormItem><FormLabel>Not <span className="font-normal text-muted-foreground">isteğe bağlı</span></FormLabel><FormControl><Textarea data-testid="input-overtime-note" maxLength={500} placeholder="Vardiya veya iş emri detayı..." className="resize-none" {...field} /></FormControl><FormMessage /></FormItem>} />
              <div className="rounded-lg border border-primary/15 bg-secondary/60 p-3 text-xs leading-5 text-secondary-foreground">Planlanan süre borçtan düşülmez. Mahsup yalnızca gerçekleşen saatler kaydedildiğinde hesaplanır.</div>
               <DialogFooter><Button type="button" variant="ghost" onClick={closeCreate}>Vazgeç</Button><Button type="submit" data-testid="button-submit-overtime" disabled={create.isPending || employeesLoading || departmentsLoading || employeesError || departmentsError}>{create.isPending ? "Oluşturuluyor..." : "Planı oluştur"}</Button></DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>}
      {editable && <AlertDialog open={!!deleting} onOpenChange={(next) => { if (!next && !remove.isPending) setDeleting(null) }}>
        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Fazla mesai planı silinsin mi?</AlertDialogTitle><AlertDialogDescription>{deleting && `${dateLabel(deleting.workDate)} tarihli plan ve tüm katılımcı saatleri silinecek. Borç hesabı buna göre yeniden hesaplanır.`}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={remove.isPending}>Vazgeç</AlertDialogCancel><AlertDialogAction data-testid="button-confirm-delete-overtime" className="bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={remove.isPending} onClick={(event) => { event.preventDefault(); if (!deleting) return; remove.mutate({ id: deleting.id }, { onSuccess: () => { refreshAffected(); setDeleting(null); toast({ title: "Fazla mesai planı silindi" }) }, onError: (error) => toast({ title: "Plan silinemedi", description: error.message, variant: "destructive" }) }) }}>{remove.isPending ? "Siliniyor..." : <><X className="mr-1 h-4 w-4" /> Planı sil</>}</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
      </AlertDialog>}
    </Layout>
  )
}