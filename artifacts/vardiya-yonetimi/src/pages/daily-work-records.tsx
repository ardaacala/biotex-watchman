import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { format, parseISO } from "date-fns"
import { tr } from "date-fns/locale"
import { CalendarDays, CheckCircle2, Loader2, Save, Building2 } from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"
import { useLocation } from "wouter"
import {
  DailyEmployeeWorkRecord,
  getGetDailyWorkRecordsQueryKey,
  getListWorkDebtsQueryKey,
  useGetDailyWorkRecords,
  useSaveDailyWorkRecords,
} from "@workspace/api-client-react"
import { Layout } from "@/components/layout"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { employeePhotoUrl } from "@/lib/employee-photo"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useAuth } from "@/lib/auth"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import { hoursFromTimes } from "@/lib/work-hours"

type DraftRecord = Pick<DailyEmployeeWorkRecord, "employeeId" | "actualHours" | "checkIn" | "checkOut" | "note">
type PendingAction =
  | { kind: "date"; value: string }
  | { kind: "navigate"; value: string }
  | { kind: "logout" }
  | { kind: "history-back" }

const HISTORY_GUARD_KEY = "__dailyWorkRecordsUnsavedGuard"
const routerBasePath = import.meta.env.BASE_URL.replace(/\/$/, "")

function toDraft(record: DailyEmployeeWorkRecord): DraftRecord {
  return {
    employeeId: record.employeeId,
    actualHours: record.actualHours,
    checkIn: record.checkIn,
    checkOut: record.checkOut,
    note: record.note,
  }
}

export default function DailyWorkRecordsPage() {
  const [date, setDate] = useState(() => format(new Date(), "yyyy-MM-dd"))
  const [drafts, setDrafts] = useState<Record<number, DraftRecord>>({})
  const [isDirty, setIsDirty] = useState(false)
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)
  const isHistoryProceedingRef = useRef(false)
  const afterHistoryGuardClearedRef = useRef<(() => void) | null>(null)
  const isDirtyRef = useRef(isDirty)
  const [, setLocation] = useLocation()
  const queryClient = useQueryClient()
  const { logout } = useAuth()
  const { toast } = useToast()
  const { data, isLoading, isError } = useGetDailyWorkRecords(date)
  const saveMutation = useSaveDailyWorkRecords()

  useEffect(() => {
    isDirtyRef.current = isDirty
  }, [isDirty])

  useEffect(() => {
    const guardHistoryNavigation = () => {
      if (isHistoryProceedingRef.current) {
        isHistoryProceedingRef.current = false
        const afterClear = afterHistoryGuardClearedRef.current
        afterHistoryGuardClearedRef.current = null
        afterClear?.()
        return
      }
      if (!isDirtyRef.current) return
      const state = window.history.state as Record<string, unknown> | null
      if (state?.[HISTORY_GUARD_KEY]) return
      setPendingAction({ kind: "history-back" })
      window.history.forward()
    }

    window.addEventListener("popstate", guardHistoryNavigation)
    return () => window.removeEventListener("popstate", guardHistoryNavigation)
  }, [])

  const clearCurrentHistoryGuard = useCallback((afterClear: () => void) => {
    const state = window.history.state as Record<string, unknown> | null
    if (!state?.[HISTORY_GUARD_KEY]) {
      afterClear()
      return
    }
    afterHistoryGuardClearedRef.current = afterClear
    isHistoryProceedingRef.current = true
    window.history.back()
  }, [])

  const completePendingAction = useCallback((action: PendingAction | null) => {
    if (!action) return
    setPendingAction(null)
    if (action.kind === "date") {
      clearCurrentHistoryGuard(() => {
        setIsDirty(false)
        setDate(action.value)
      })
    }
    else if (action.kind === "navigate") {
      clearCurrentHistoryGuard(() => {
        setIsDirty(false)
        setLocation(action.value)
      })
    }
    else if (action.kind === "logout") {
      clearCurrentHistoryGuard(() => {
        setIsDirty(false)
        void logout()
      })
    }
    else {
      isHistoryProceedingRef.current = true
      setIsDirty(false)
      window.history.go(-2)
    }
  }, [clearCurrentHistoryGuard, logout, setLocation])

  useEffect(() => {
    if (!data) return
    setDrafts(Object.fromEntries(data.records.map((record) => [record.employeeId, toDraft(record)])))
    setIsDirty(false)
  }, [data])

  useEffect(() => {
    if (!isDirty) return

    const currentState = window.history.state as Record<string, unknown> | null
    if (!currentState?.[HISTORY_GUARD_KEY]) {
      window.history.pushState(
        { ...currentState, [HISTORY_GUARD_KEY]: true },
        "",
        window.location.href,
      )
    }

    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ""
    }
    const guardInternalNavigation = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const target = event.target as Element | null
      const link = target?.closest("a[href]") as HTMLAnchorElement | null
      if (!link || link.target === "_blank" || link.hasAttribute("download")) return
      const destination = new URL(link.href, window.location.href)
      if (destination.origin !== window.location.origin || destination.href === window.location.href) return
      event.preventDefault()
      event.stopPropagation()
      const pathname = routerBasePath && destination.pathname.startsWith(`${routerBasePath}/`)
        ? destination.pathname.slice(routerBasePath.length)
        : destination.pathname
      setPendingAction({ kind: "navigate", value: `${pathname}${destination.search}${destination.hash}` })
    }

    window.addEventListener("beforeunload", warnBeforeUnload)
    document.addEventListener("click", guardInternalNavigation, true)
    return () => {
      window.removeEventListener("beforeunload", warnBeforeUnload)
      document.removeEventListener("click", guardInternalNavigation, true)
    }
  }, [isDirty])

  const totals = useMemo(() => {
    const planned = data?.records.reduce((sum, record) => sum + record.plannedHours, 0) ?? 0
    const actual = Object.values(drafts).reduce((sum, record) => sum + (record.actualHours ?? 0), 0)
    return { planned, actual }
  }, [data, drafts])

  const groupedRecords = useMemo(() => {
    if (!data?.records) return []
    const groups: Record<string, typeof data.records> = {}
    data.records.forEach(r => {
      if (!groups[r.department]) groups[r.department] = []
      groups[r.department].push(r)
    })
    return Object.entries(groups).sort((a,b) => a[0].localeCompare(b[0]))
  }, [data])

  function updateDraft(employeeId: number, changes: Partial<DraftRecord>) {
    setDrafts((current) => ({
      ...current,
      [employeeId]: { ...current[employeeId], ...changes },
    }))
    setIsDirty(true)
  }

  function updateTime(record: DailyEmployeeWorkRecord, changes: Partial<Pick<DraftRecord, "checkIn" | "checkOut">>) {
    setDrafts((current) => {
      const draft = current[record.employeeId] ?? toDraft(record)
      const updated = { ...draft, ...changes }
      return {
        ...current,
        [record.employeeId]: {
          ...updated,
          actualHours: hoursFromTimes(record.plannedHours, record.plannedStart, record.plannedEnd, updated.checkIn, updated.checkOut),
        },
      }
    })
    setIsDirty(true)
  }

  function updateHours(record: DailyEmployeeWorkRecord, actualHours: number | null) {
    setDrafts((current) => {
      const draft = current[record.employeeId] ?? toDraft(record)
      const short = actualHours !== null && actualHours < record.plannedHours
      return {
        ...current,
        [record.employeeId]: {
          ...draft,
          actualHours,
          checkIn: short && draft.checkIn === record.plannedStart ? null : draft.checkIn,
          checkOut: short && draft.checkOut === record.plannedEnd ? null : draft.checkOut,
        },
      }
    })
    setIsDirty(true)
  }

  function saveAll(afterSave: PendingAction | null = null) {
    if (!data) return
    saveMutation.mutate({
      date,
      data: {
        records: data.records.map((record) => drafts[record.employeeId] ?? toDraft(record)),
      },
    }, {
      onSuccess: (saved) => {
        queryClient.setQueryData(getGetDailyWorkRecordsQueryKey(date), saved)
        queryClient.invalidateQueries({ queryKey: getListWorkDebtsQueryKey() })
        queryClient.invalidateQueries({
          predicate: ({ queryKey }) => String(queryKey[0]).includes("/work-history/"),
        })
        if (afterSave) completePendingAction(afterSave)
        else clearCurrentHistoryGuard(() => setIsDirty(false))
        toast({
          title: "Günlük kayıtlar kaydedildi",
          description: `${saved.records.length} personelin çalışma kaydı güncellendi.`,
        })
      },
      onError: (error) => {
        toast({
          title: "Kayıtlar kaydedilemedi",
          description: error instanceof Error ? error.message : "Lütfen tekrar deneyin.",
          variant: "destructive",
        })
      },
    })
  }

  return (
    <Layout onLogoutRequest={() => {
      if (isDirty) setPendingAction({ kind: "logout" })
      else void logout()
    }}>
      <div className="flex flex-1 flex-col overflow-hidden p-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Personel Devam Takibi</h1>
            <p className="mt-1 text-muted-foreground">Tüm aktif personel departmanlarına göre listelenmiştir. Planlanan saatleri, giriş-çıkışları ve çalışılan süreleri yönetin.</p>
          </div>
          <div className="flex items-end gap-3">
            <label className="block text-sm font-medium">
              <span className="mb-1.5 block text-muted-foreground">Çalışma tarihi</span>
              <Input
                type="date"
                value={date}
                onChange={(event) => {
                  const nextDate = event.target.value
                  if (nextDate === date) return
                  if (isDirty) setPendingAction({ kind: "date", value: nextDate })
                  else setDate(nextDate)
                }}
                className="w-44"
                data-testid="input-work-date"
              />
            </label>
            <Button onClick={() => saveAll()} disabled={!data || !isDirty || saveMutation.isPending} data-testid="button-save-all">
              {saveMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Tümünü Kaydet
            </Button>
          </div>
        </div>

        <div className="mb-5 grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl border bg-card p-4 shadow-sm">
            <p className="text-sm text-muted-foreground font-medium">Seçili gün</p>
            <p className="mt-1 font-bold text-foreground text-lg">{format(parseISO(date), "d MMMM yyyy, EEEE", { locale: tr })}</p>
          </div>
          <div className="rounded-xl border bg-card p-4 shadow-sm">
            <p className="text-sm text-muted-foreground font-medium">Toplam planlanan</p>
            <p className="mt-1 text-2xl font-extrabold text-foreground">{totals.planned.toFixed(1).replace(".0", "")} <span className="text-sm font-semibold text-muted-foreground">saat</span></p>
          </div>
          <div className="rounded-xl border bg-card p-4 shadow-sm">
            <p className="text-sm text-muted-foreground font-medium">Toplam gerçekleşen</p>
            <p className="mt-1 text-2xl font-extrabold text-primary">{totals.actual.toFixed(1).replace(".0", "")} <span className="text-sm font-semibold text-primary/70">saat</span></p>
          </div>
        </div>

        <div className="flex-1 overflow-auto rounded-xl border bg-card shadow-sm">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-muted/95 backdrop-blur">
              <TableRow>
                <TableHead className="min-w-[230px]">Personel</TableHead>
                <TableHead className="w-[110px]">Durum</TableHead>
                <TableHead className="w-[110px]">Planlanan</TableHead>
                <TableHead className="w-[130px]">Giriş</TableHead>
                <TableHead className="w-[130px]">Çıkış</TableHead>
                <TableHead className="w-[130px]">Çalışılan Saat</TableHead>
                <TableHead className="min-w-[220px]">Not</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={7} className="h-40 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" /></TableCell></TableRow>
              ) : isError ? (
                <TableRow><TableCell colSpan={7} className="h-40 text-center text-destructive font-semibold">Günlük kayıtlar yüklenemedi.</TableCell></TableRow>
              ) : groupedRecords.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="h-40 text-center text-muted-foreground font-medium">Aktif personel bulunmuyor.</TableCell></TableRow>
              ) : groupedRecords.map(([department, records]) => (
                <Fragment key={department}>
                  <TableRow className="bg-muted/40 hover:bg-muted/40 border-b">
                    <TableCell colSpan={7} className="py-2.5">
                      <div className="font-bold text-sm text-foreground flex items-center gap-2">
                        <Building2 className="w-4 h-4 text-primary" /> {department}
                      </div>
                    </TableCell>
                  </TableRow>
                  {records.map((record) => {
                    const draft = drafts[record.employeeId] ?? toDraft(record)
                    const isLate = record.plannedStart && draft.checkIn ? draft.checkIn > record.plannedStart : false
                    const isEarly = record.plannedEnd && draft.checkOut ? draft.checkOut < record.plannedEnd : false
                    const hoursDiff = draft.actualHours !== null ? Number((draft.actualHours - record.plannedHours).toFixed(1)) : null;

                    return (
                      <TableRow key={record.employeeId} className={record.status !== "work" ? "bg-muted/10" : undefined}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <Avatar className="h-9 w-9" style={{ backgroundColor: record.avatarColor }}>
                              <AvatarImage src={employeePhotoUrl(record.employeeId, record.photoPath)} alt={`${record.employeeName} fotoğrafı`} className="object-cover" />
                              <AvatarFallback className="bg-transparent text-xs font-semibold text-white">
                                {record.employeeName.split(" ").map((part) => part[0]).join("").slice(0, 2)}
                              </AvatarFallback>
                            </Avatar>
                            <div>
                              <p className="font-semibold text-foreground leading-none mb-1.5">{record.employeeName}</p>
                              <p className="text-[11px] text-muted-foreground font-medium">{record.employeeNumber} &middot; Kalan İzin: <span className="font-bold text-foreground">{record.remainingAnnualLeave === null ? "İşe giriş tarihi eksik" : `${record.remainingAnnualLeave} gün`}</span></p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          {record.status === "work" && <Badge className="bg-primary/10 text-primary hover:bg-primary/20 border-primary/20 font-bold shadow-none">Çalışma</Badge>}
                          {record.status === "leave" && <Badge className="bg-accent/20 text-accent-foreground hover:bg-accent/30 border-accent/30 font-bold shadow-none">İzinli</Badge>}
                          {record.status === "rest" && <Badge variant="secondary" className="font-bold opacity-80 shadow-none">Dinlenme</Badge>}
                        </TableCell>
                        <TableCell>
                          <div className="font-bold text-foreground whitespace-nowrap mb-0.5">
                            {record.plannedStart && record.plannedEnd ? `${record.plannedStart} - ${record.plannedEnd}` : '—'}
                          </div>
                          <div className="text-xs text-muted-foreground font-medium">
                            {record.plannedHours.toFixed(1).replace(".0", "")} saat
                          </div>
                        </TableCell>
                        <TableCell>
                          <Input 
                            type="time" 
                            value={draft.checkIn ?? ""} 
                            onChange={(event) => updateTime(record, { checkIn: event.target.value || null })}
                            aria-label={`${record.employeeName} giriş saati`} 
                            className={cn("h-9 font-medium", isLate && "border-destructive text-destructive focus-visible:ring-destructive bg-destructive/5")}
                          />
                          {isLate && <div className="text-[10px] text-destructive mt-1 font-bold">Geç Kaldı</div>}
                        </TableCell>
                        <TableCell>
                          <Input 
                            type="time" 
                            value={draft.checkOut ?? ""} 
                            onChange={(event) => updateTime(record, { checkOut: event.target.value || null })}
                            aria-label={`${record.employeeName} çıkış saati`}
                            className={cn("h-9 font-medium", isEarly && "border-destructive text-destructive focus-visible:ring-destructive bg-destructive/5")}
                          />
                          {isEarly && <div className="text-[10px] text-destructive mt-1 font-bold">Erken Çıktı</div>}
                        </TableCell>
                        <TableCell>
                          <Input 
                            type="number" min="0" max="24" step="0.5" 
                            value={draft.actualHours ?? ""} 
                            onChange={(event) => updateHours(record, event.target.value === "" ? null : Number(event.target.value))}
                            aria-label={`${record.employeeName} çalışılan saat`} 
                            className="h-9 font-bold"
                          />
                          {hoursDiff !== null && hoursDiff !== 0 && (
                            <div className={cn("text-[10px] mt-1 font-extrabold", hoursDiff > 0 ? "text-accent" : "text-destructive")}>
                              {hoursDiff > 0 ? "Fazla" : "Eksik"}: {Math.abs(hoursDiff)} s.
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          <Input 
                            value={draft.note} maxLength={500} placeholder="Not ekleyin..." 
                            onChange={(event) => updateDraft(record.employeeId, { note: event.target.value })} 
                            aria-label={`${record.employeeName} çalışma notu`} 
                            className="h-9"
                          />
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </div>

        <div className="mt-3 flex h-6 items-center justify-end text-sm text-muted-foreground font-medium">
          {isDirty ? "Kaydedilmemiş değişiklikler var." : data && <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-emerald-600" /> Tüm değişiklikler kaydedildi.</span>}
        </div>

        <AlertDialog open={pendingAction !== null} onOpenChange={(open) => !open && setPendingAction(null)}>
          <AlertDialogContent data-testid="dialog-unsaved-changes">
            <AlertDialogHeader>
              <AlertDialogTitle>Kaydedilmemiş değişiklikler var</AlertDialogTitle>
              <AlertDialogDescription>
                Günlük saatlerde yaptığınız değişiklikler henüz kaydedilmedi. Devam etmeden önce ne yapmak istediğinizi seçin.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <Button type="button" variant="outline" onClick={() => setPendingAction(null)} data-testid="button-stay">
                Ekranda Kal
              </Button>
              <Button type="button" variant="destructive" onClick={() => completePendingAction(pendingAction)} data-testid="button-discard-changes">
                Değişikliklerden Vazgeç
              </Button>
              <Button type="button" onClick={() => saveAll(pendingAction)} disabled={saveMutation.isPending} data-testid="button-save-and-continue">
                {saveMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Kaydet ve Devam Et
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </Layout>
  )
}
