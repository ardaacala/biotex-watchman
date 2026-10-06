import { useEffect, useRef, useState } from "react"
import { useSearch } from "wouter"
import { useQueryClient } from "@tanstack/react-query"
import { Layout } from "@/components/layout"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { useListLeaves, useCreateLeave, useUpdateLeaveStatus, useListEmployees, useListWorkDebts, getListLeavesQueryKey, getListWorkDebtsQueryKey, type Leave, type LeaveStatusUpdateStatus, type LeaveAttachmentInputContentType } from "@workspace/api-client-react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Search, Plus, CheckCircle, XCircle, ChevronsUpDown, Check, Paperclip, X } from "lucide-react"
import { hasOperationalAccess, useAuth } from "@/lib/auth"
import { useToast } from "@/hooks/use-toast"
import { LeaveHistory } from "@/components/leave-history"
import { LeaveEntryBadge } from "@/components/leave-entry-badge"
import { LeaveCalendar } from "@/components/leave-calendar"
import { CalendarDays } from "lucide-react"
import { LeaveOverlap } from "@/components/leave-overlap"
import { annualCapacityConflict, formatDay, overlapSummary, todayInIstanbul } from "@/lib/leave-occupancy"

const allowedAttachmentTypes = new Set([
  "image/jpeg", "image/png", "image/webp", "application/pdf",
  "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
])
const maxAttachmentSize = 10 * 1024 * 1024
const numberFormat = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 })
const formatHours = (value: number) => `${numberFormat.format(value)} saat`
const formatDaysEquivalent = (value: number) => `${numberFormat.format(value / 9)} gün`

function formatLeaveDate(value: string) {
  const dateValue = value.slice(0, 10)
  return new Date(dateValue.length === 10 ? `${dateValue}T12:00:00Z` : value)
    .toLocaleDateString("tr-TR", { timeZone: "UTC", dateStyle: "medium" })
}

function isLeaveAttachmentType(type: string): type is LeaveAttachmentInputContentType {
  return allowedAttachmentTypes.has(type)
}

async function uploadLeaveAttachment(file: File) {
  const contentType = file.type
  if (!isLeaveAttachmentType(contentType)) throw new Error(`${file.name}: Desteklenmeyen dosya türü.`)
  const response = await fetch("/api/storage/leave-attachments/upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: file.name, size: file.size, contentType }),
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error || `Dosya için yükleme izni alınamadı (${response.status}).`)
  }
  const { uploadURL, objectPath } = await response.json() as { uploadURL: string; objectPath: string }
  const uploaded = await fetch(uploadURL, { method: "PUT", headers: { "Content-Type": contentType }, body: file })
  if (!uploaded.ok) throw new Error(`${file.name} yüklenemedi (${uploaded.status}).`)
  return { objectPath, name: file.name, size: file.size, contentType }
}

const leaveSchema = z.object({
  isRetrospective: z.boolean(),
  employeeId: z.coerce.number().min(1, "Personel seçimi gerekli"),
  type: z.enum(['annual', 'sick', 'unpaid', 'other']),
  settlementType: z.enum(['full', 'debt']),
  startDate: z.string().min(1, "Başlangıç tarihi gerekli"),
  endDate: z.string().min(1, "Bitiş tarihi gerekli"),
  note: z.string().trim().min(1, "Açıklama gerekli").max(1000, "Açıklama en fazla 1000 karakter olabilir."),
}).refine(value => value.startDate <= value.endDate, { path: ["endDate"], message: "Bitiş tarihi başlangıçtan önce olamaz." })
  .superRefine((value, ctx) => {
    if (!value.isRetrospective) return
    const today = todayInIstanbul()
    if (value.startDate.slice(0, 4) !== today.slice(0, 4) || value.endDate.slice(0, 4) !== today.slice(0, 4)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["startDate"], message: "Geçmiş izin yalnızca bu takvim yılı içinde olabilir." })
    }
    if (value.endDate >= today) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["endDate"], message: "Kullanılmış iznin bitişi bugünden önce olmalıdır." })
    }
  })

type LeaveFormValues = z.infer<typeof leaveSchema>

export default function LeavesPage() {
  const search = useSearch()
  const handledEntry = useRef("")
  const [searchTerm, setSearchTerm] = useState("")
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [employeePickerOpen, setEmployeePickerOpen] = useState(false)
  const [attachments, setAttachments] = useState<File[]>([])
  const [attachmentError, setAttachmentError] = useState("")
  const [uploading, setUploading] = useState(false)
  const [reviewSnapshot, setReviewLeave] = useState<Leave | null>(null)
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [reviewDecision, setReviewDecision] = useState<LeaveStatusUpdateStatus | null>(null)
  const [createAcknowledged, setCreateAcknowledged] = useState(false)
  const [reviewAcknowledged, setReviewAcknowledged] = useState(false)
  const [createAcknowledgedSignature, setCreateAcknowledgedSignature] = useState("")
  const [reviewAcknowledgedSignature, setReviewAcknowledgedSignature] = useState("")
  const { user } = useAuth()
  const { toast } = useToast()
  const canManageOperations = hasOperationalAccess(user?.role)
  
  const queryClient = useQueryClient()
  const { data: leaves, isLoading: leavesLoading, isFetching: leavesFetching, isError: leavesError, refetch: refetchLeaves } = useListLeaves()
  const reviewLeave = reviewSnapshot && (leaves?.find(leave => leave.id === reviewSnapshot.id) ?? reviewSnapshot)
  useEffect(() => { if (!reviewSnapshot) setCalendarOpen(false) }, [reviewSnapshot])
  const reviewStillPending = !!reviewSnapshot && !!leaves?.some(leave => leave.id === reviewSnapshot.id && leave.status === "pending")
  const { data: allEmployees = [], isLoading: employeesLoading } = useListEmployees({ status: 'all' })
  const { data: workDebtReport, isLoading: workDebtsLoading, isError: workDebtsError, refetch: refetchWorkDebts } = useListWorkDebts({
    query: { enabled: canManageOperations, queryKey: getListWorkDebtsQueryKey() },
  })
  
  const createMutation = useCreateLeave()
  const updateStatusMutation = useUpdateLeaveStatus()

  const form = useForm<LeaveFormValues>({
    resolver: zodResolver(leaveSchema),
    defaultValues: {
      isRetrospective: false,
      employeeId: undefined,
      type: 'annual',
      settlementType: 'full',
      startDate: todayInIstanbul(),
      endDate: todayInIstanbul(),
      note: ""
    }
  })
  const startDate = form.watch("startDate")
  const endDate = form.watch("endDate")
  const retrospective = form.watch("isRetrospective")
  const leaveType = form.watch("type")
  const employeeId = form.watch("employeeId")
  const employees = allEmployees.filter(employee => retrospective || employee.status === "active")
  const selectedEmployee = employees.find((employee) => employee.id === form.watch("employeeId"))
  const today = todayInIstanbul()
  const yesterdayDate = new Date(`${today}T00:00:00Z`)
  yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1)
  const yesterday = yesterdayDate.toISOString().slice(0, 10)
  useEffect(() => {
    if (!canManageOperations || !search || handledEntry.current === search) return
    const params = new URLSearchParams(search)
    const employeeId = Number(params.get("employeeId"))
    if (params.get("mode") !== "retrospective" || !Number.isSafeInteger(employeeId) || employeeId <= 0) return
    handledEntry.current = search
    form.reset({
      isRetrospective: true,
      employeeId,
      type: "annual",
      settlementType: "full",
      startDate: yesterday,
      endDate: yesterday,
      note: "",
    })
    setAttachments([])
    setAttachmentError("")
    setCreateAcknowledged(false)
    setIsCreateOpen(true)
    void refetchLeaves()
  }, [search, canManageOperations, form, yesterday, refetchLeaves])
  const createOverlap = leaves ? overlapSummary(leaves, startDate, endDate) : null
  const reviewOverlap = leaves && reviewLeave ? overlapSummary(leaves, reviewLeave.startDate.slice(0, 10), reviewLeave.endDate.slice(0, 10), reviewLeave.id) : null
  const createCapacityConflict = leaves && leaveType === "annual"
    ? annualCapacityConflict(leaves, startDate, endDate, employeeId) : null
  const reviewCapacityConflict = leaves && reviewLeave?.type === "annual" && reviewDecision === "approved"
    ? annualCapacityConflict(leaves, reviewLeave.startDate.slice(0, 10), reviewLeave.endDate.slice(0, 10), reviewLeave.employeeId, reviewLeave.id) : null
  const capacityMessage = (date: string) => `${formatDay(date)} tarihinde iki farklı personelin yıllık izni onaylı. Aynı gün üçüncü bir kişi yıllık izin alamaz. Tarihleri değiştirin; çakışma onayı bu sınırı kaldırmaz.`
  const overlapSignature = (value: ReturnType<typeof overlapSummary>) =>
    value?.matches.map(item => `${item.id}:${item.status}:${item.startDate}:${item.endDate}`).join("|") ?? ""

  const onSubmitCreate = async (data: LeaveFormValues) => {
    if (leavesError || !leaves || leavesFetching) {
      toast({ title: "İzinler henüz hazır değil", description: "İzin kontrolü tamamlanınca tekrar deneyin.", variant: "destructive" })
      return
    }
    const previous = overlapSignature(overlapSummary(leaves, data.startDate, data.endDate))
    if (previous && (!createAcknowledged || createAcknowledgedSignature !== previous)) {
      toast({ title: "Çakışma onayı gerekli", description: "Güncel izinleri inceleyip onay kutusunu işaretleyin.", variant: "destructive" })
      return
    }
    const fresh = await refetchLeaves()
    if (fresh.isError || !fresh.data) {
      toast({ title: "İzinler yenilenemedi", description: "Çakışmaları kontrol etmek için yeniden deneyin.", variant: "destructive" })
      return
    }
    const capacityConflict = data.type === "annual"
      ? annualCapacityConflict(fresh.data, data.startDate, data.endDate, data.employeeId) : null
    if (capacityConflict) {
      toast({ title: "Yıllık izin sınırı dolu", description: capacityMessage(capacityConflict), variant: "destructive" })
      return
    }
    if (data.isRetrospective && fresh.data.some(leave =>
      leave.employeeId === data.employeeId && leave.status !== "rejected" &&
      leave.startDate.slice(0, 10) <= data.endDate && leave.endDate.slice(0, 10) >= data.startDate,
    )) {
      toast({ title: "Bu tarihlerde izin zaten var", description: "Aynı personelin bekleyen veya onaylanmış izni yeniden eklenemez.", variant: "destructive" })
      return
    }
    const current = overlapSignature(overlapSummary(fresh.data, data.startDate, data.endDate))
    if (current !== previous) {
      setCreateAcknowledged(false)
      toast({ title: "İzin durumu değişti", description: "Güncel çakışmaları inceleyip yeniden onaylayın.", variant: "destructive" })
      return
    }
    setUploading(true)
    setAttachmentError("")
    try {
      const uploaded = await Promise.all(attachments.map(uploadLeaveAttachment))
      await createMutation.mutateAsync({ data: { ...data, note: data.note.trim(), attachments: uploaded } })
      void queryClient.invalidateQueries({ queryKey: getListLeavesQueryKey() })
      void queryClient.invalidateQueries({ queryKey: getListWorkDebtsQueryKey() })
      void queryClient.invalidateQueries({ predicate: ({ queryKey }) =>
        ["/employees", "/dashboard", "/daily-work-records", "/activity"].some(path => JSON.stringify(queryKey).includes(path)),
      })
      setIsCreateOpen(false)
        form.reset()
        setCreateAcknowledged(false)
      setAttachments([])
      toast({ title: data.isRetrospective ? "Geçmiş izin sonradan eklendi" : "İzin talebi oluşturuldu" })
    } catch (error) {
      toast({ title: "Talep kaydedilemedi", description: error instanceof Error ? error.message : "Belgeler yüklenemedi.", variant: "destructive" })
    } finally {
      setUploading(false)
    }
  }

  const handleStatusUpdate = async (id: number, status: LeaveStatusUpdateStatus) => {
    if (!leaves || leavesError || leavesFetching || !reviewLeave) {
      toast({ title: "İzinler henüz hazır değil", description: "Kontrol tamamlanınca tekrar deneyin.", variant: "destructive" })
      return
    }
    if (!reviewStillPending) {
      setReviewLeave(null)
      setReviewDecision(null)
      toast({ title: "Talep artık beklemede değil", description: "Bu talep hakkında yeniden karar verilemez.", variant: "destructive" })
      return
    }
    const previous = overlapSignature(reviewOverlap)
    if (previous && (!reviewAcknowledged || reviewAcknowledgedSignature !== previous)) {
      toast({ title: "Çakışma onayı gerekli", description: "Güncel izinleri inceleyip onay kutusunu işaretleyin.", variant: "destructive" })
      return
    }
    const fresh = await refetchLeaves()
    if (fresh.isError || !fresh.data) {
      toast({ title: "İzinler yenilenemedi", description: "Karar vermeden önce tekrar deneyin.", variant: "destructive" })
      return
    }
    const freshRequest = fresh.data.find(leave => leave.id === id)
    if (!freshRequest || freshRequest.status !== "pending") {
      setReviewLeave(null)
      setReviewDecision(null)
      setReviewAcknowledged(false)
      toast({ title: "Talep artık beklemede değil", description: "Talep başka bir işlemle sonuçlanmış veya kaldırılmış. Liste güncellendi.", variant: "destructive" })
      return
    }
    if (freshRequest.startDate !== reviewLeave.startDate || freshRequest.endDate !== reviewLeave.endDate) {
      setReviewAcknowledged(false)
      toast({ title: "Talep tarihleri değişti", description: "Güncel tarihleri ve çakışmaları yeniden inceleyin.", variant: "destructive" })
      return
    }
    const capacityConflict = status === "approved" && freshRequest.type === "annual"
      ? annualCapacityConflict(fresh.data, freshRequest.startDate.slice(0, 10), freshRequest.endDate.slice(0, 10), freshRequest.employeeId, id) : null
    if (capacityConflict) {
      toast({ title: "Yıllık izin onaylanamaz", description: capacityMessage(capacityConflict), variant: "destructive" })
      return
    }
    const current = overlapSignature(overlapSummary(fresh.data, reviewLeave.startDate.slice(0, 10), reviewLeave.endDate.slice(0, 10), id))
    if (current !== previous) {
      setReviewAcknowledged(false)
      toast({ title: "İzin durumu değişti", description: "Güncel çakışmaları inceleyip yeniden onaylayın.", variant: "destructive" })
      return
    }
    updateStatusMutation.mutate({ id, data: { status } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListLeavesQueryKey() })
        queryClient.invalidateQueries({ queryKey: getListWorkDebtsQueryKey() })
        queryClient.invalidateQueries({ predicate: ({ queryKey }) =>
          ["/employees", "/daily-work-records", "/work-history/", "/dashboard/summary"].some((path) => JSON.stringify(queryKey).includes(path)),
        })
        setReviewLeave(null)
        setReviewDecision(null)
        setReviewAcknowledged(false)
        toast({ title: status === "approved" ? "İzin onaylandı" : "İzin reddedildi" })
      },
      onError: (error) => toast({ title: "İşlem tamamlanamadı", description: error.message, variant: "destructive" }),
    })
  }

  const filteredLeaves = (leaves ?? []).filter(l => l.status === "pending" &&
    (!searchTerm || l.employeeName.toLocaleLowerCase("tr-TR").includes(searchTerm.toLocaleLowerCase("tr-TR"))))

  const getTypeLabel = (type: string) => {
    const types: Record<string, string> = {
      annual: 'Yıllık İzin',
      sick: 'Hastalık',
      unpaid: 'Ücretsiz',
      other: 'Diğer'
    }
    return types[type] || type
  }

  return (
    <Layout>
      <div className="flex-1 overflow-auto px-4 py-6 sm:p-8 flex flex-col gap-6">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-2">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">İzin Talepleri</h1>
            <p className="text-muted-foreground mt-1">Personel izin ve devamsızlık yönetimi</p>
          </div>
          
          <Dialog open={isCreateOpen} onOpenChange={(open) => {
             if (!open && (uploading || createMutation.isPending)) return
            setIsCreateOpen(open)
              if (open) { setCreateAcknowledged(false); void refetchLeaves() }
             if (!open) {
               setEmployeePickerOpen(false)
               setAttachments([])
               setAttachmentError("")
                setCreateAcknowledged(false)
               form.reset()
             }
          }}>
            <DialogTrigger asChild>
              <Button className="gap-2"><Plus className="h-4 w-4" /> İzin Ekle</Button>
            </DialogTrigger>
              <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
              <DialogHeader>
                <DialogTitle>{retrospective ? "Geçmiş izin ekle" : "Yeni İzin Talebi"}</DialogTitle>
              </DialogHeader>
              <Form {...form}>
                 <form onSubmit={form.handleSubmit(onSubmitCreate)} className="space-y-4">
                   <fieldset disabled={uploading || createMutation.isPending} className="space-y-4">
                  <FormField control={form.control} name="isRetrospective" render={({ field }) => (
                    <FormItem className="rounded-lg border bg-muted/30 p-3">
                      <FormLabel className="flex cursor-pointer items-center gap-2">
                        <FormControl><input type="checkbox" checked={field.value} onChange={event => {
                          field.onChange(event.target.checked)
                          if (!event.target.checked && selectedEmployee?.status === "inactive") {
                            form.setValue("employeeId", 0)
                          }
                          setCreateAcknowledged(false)
                          if (event.target.checked && form.getValues("endDate") >= today) {
                            form.setValue("startDate", yesterday)
                            form.setValue("endDate", yesterday)
                          }
                        }} className="h-4 w-4 accent-primary" data-testid="input-retrospective-leave" /></FormControl>
                        Geçmişte kullanılmış izin
                      </FormLabel>
                      <p className="text-xs leading-5 text-muted-foreground">Bu yıl içinde daha önce kullanılmış izni kaydedin. Yönetici ve İK ekleyebilir. Kayıt doğrudan onaylı olur, “Sonradan eklendi” etiketi taşır ve ilgili izin bakiyesine işlenir.</p>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="employeeId" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Personel</FormLabel>
                      <Popover open={employeePickerOpen} onOpenChange={setEmployeePickerOpen}>
                        <PopoverTrigger asChild>
                          <FormControl>
                            <Button
                              type="button"
                              variant="outline"
                              role="combobox"
                              aria-expanded={employeePickerOpen}
                              aria-label="Personel seçin veya arayın"
                              data-testid="button-search-leave-employee"
                              className="w-full justify-between text-left font-normal"
                            >
                              <span className="truncate">
                                {employees.find((employee) => employee.id === field.value)?.name ?? "Personel seçin"}
                              </span>
                              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                            </Button>
                          </FormControl>
                        </PopoverTrigger>
                        <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-0">
                          <Command>
                            <CommandInput
                              autoFocus
                              placeholder="İsim, sicil veya departman ara..."
                              aria-label="Personel ara"
                              data-testid="input-search-leave-employee"
                            />
                            <CommandList>
                              <CommandEmpty>{employeesLoading ? "Personel yükleniyor..." : "Personel bulunamadı"}</CommandEmpty>
                              {employees.map((employee) => (
                                <CommandItem
                                  key={employee.id}
                                  value={`${employee.name} ${employee.employeeNumber} ${employee.department}`}
                                  onSelect={() => {
                                    field.onChange(employee.id)
                                    setEmployeePickerOpen(false)
                                  }}
                                  data-testid={`option-leave-employee-${employee.id}`}
                                >
                                  <Check className={`mr-2 h-4 w-4 ${field.value === employee.id ? "opacity-100" : "opacity-0"}`} />
                                  <span className="truncate">{employee.name}</span>
                                  <span className="ml-auto shrink-0 pl-2 text-xs text-muted-foreground">{employee.employeeNumber} · {employee.department}</span>
                                </CommandItem>
                              ))}
                            </CommandList>
                          </Command>
                        </PopoverContent>
                      </Popover>
                      {selectedEmployee && <p className="text-xs text-muted-foreground" data-testid="text-selected-employee-annual-balance">
                        {selectedEmployee.hireDate
                          ? `Yıllık izin: ${formatHours(selectedEmployee.annualLeaveHours)} (${formatDaysEquivalent(selectedEmployee.annualLeaveHours)}) hak · ${formatHours(selectedEmployee.usedLeaveHours)} kullanıldı · ${formatHours(selectedEmployee.pendingAnnualLeaveHours)} onay bekliyor · ${selectedEmployee.remainingAnnualLeaveHours == null ? "Hesaplanamıyor" : `${formatHours(selectedEmployee.remainingAnnualLeaveHours)} alınabilir`} (${selectedEmployee.leaveCycleStart?.slice(0, 10)} – ${selectedEmployee.leaveCycleEnd?.slice(0, 10)})`
                          : "İşe başlama tarihi eksik. Yıllık izin talebi için önce personel kaydını güncelleyin."}
                      </p>}
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="settlementType" render={({ field }) => (
                    <FormItem>
                      <FormLabel>İzin Türü</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl><SelectTrigger><SelectValue placeholder="Borç veya tam izin seçin" /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="full">Tam İzin — borç oluşturmaz</SelectItem>
                          <SelectItem value="debt">Borç İzin — talep edildiğinde borç oluşturur</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">Borç izin reddedilirse oluşan borç kalkar. Onaylandığında yıllık izin bakiyesinden düşülmez.</p>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="type" render={({ field }) => (
                    <FormItem>
                      <FormLabel>İzin Nedeni</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Tür seçin" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="annual">Yıllık İzin</SelectItem>
                          <SelectItem value="sick">Hastalık Raporu</SelectItem>
                          <SelectItem value="unpaid">Ücretsiz İzin</SelectItem>
                          <SelectItem value="other">Mazeret İzni</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <div className="grid grid-cols-2 gap-4">
                    <FormField control={form.control} name="startDate" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Başlangıç</FormLabel>
                        <FormControl><Input type="date" {...field} min={retrospective ? `${today.slice(0, 4)}-01-01` : undefined} max={retrospective ? yesterday : undefined} onChange={event => { field.onChange(event); setCreateAcknowledged(false) }} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="endDate" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Bitiş</FormLabel>
                        <FormControl><Input type="date" {...field} min={retrospective ? `${today.slice(0, 4)}-01-01` : undefined} max={retrospective ? yesterday : undefined} onChange={event => { field.onChange(event); setCreateAcknowledged(false) }} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                  <LeaveOverlap summary={createOverlap} loading={leavesLoading || leavesFetching} error={leavesError} onRetry={() => { void refetchLeaves() }} decision="create" />
                  {createCapacityConflict && <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive" data-testid="alert-annual-capacity-create">{capacityMessage(createCapacityConflict)}</p>}
                  {(leavesFetching || leavesError) && <p role="status" className="text-xs text-muted-foreground">İzin kontrolü tamamlanmadan talep gönderilemez.</p>}
                  {!!createOverlap?.matches.length && <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border bg-card p-3 text-sm leading-5">
                    <input type="checkbox" checked={createAcknowledged && createAcknowledgedSignature === overlapSignature(createOverlap)} onChange={event => { setCreateAcknowledged(event.target.checked); setCreateAcknowledgedSignature(overlapSignature(createOverlap)) }} className="mt-1 accent-primary" data-testid="input-acknowledge-create-overlap" />
                    <span>Çakışan onaylı izinleri ve bekleyen başvuruları gördüm; talebi yine de oluşturmak istiyorum.</span>
                  </label>}
                  {!!createOverlap?.matches.length && (!createAcknowledged || createAcknowledgedSignature !== overlapSignature(createOverlap)) && <p role="status" className="text-xs text-amber-700 dark:text-amber-300">Kaydetmek için çakışma onayını işaretleyin.</p>}
                  <FormField control={form.control} name="note" render={({ field }) => (
                    <FormItem>
                        <FormLabel>Açıklama (Zorunlu)</FormLabel>
                        <FormControl><Textarea {...field} required maxLength={1000} placeholder="İzin gerekçesini yazın" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                   <div className="space-y-2">
                     <label htmlFor="leave-attachments" className="text-sm font-medium">Fotoğraf veya belge (İsteğe bağlı)</label>
                     <p className="text-xs text-muted-foreground">Dilekçe, rapor veya ilgili belgeler · JPG, PNG, WebP, PDF, DOC, DOCX · en fazla 5 dosya, her biri 10 MB.</p>
                     <Input id="leave-attachments" type="file" multiple
                       accept=".jpg,.jpeg,.png,.webp,.pdf,.doc,.docx,image/jpeg,image/png,image/webp,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                       data-testid="input-leave-attachments"
                       onChange={event => {
                         const incoming = Array.from(event.target.files ?? [])
                         event.target.value = ""
                         if (!incoming.length) return
                         if (attachments.length + incoming.length > 5) {
                           setAttachmentError("En fazla 5 dosya ekleyebilirsiniz.")
                           return
                         }
                         const invalid = incoming.find(file => !allowedAttachmentTypes.has(file.type) || file.size === 0 || file.size > maxAttachmentSize)
                         if (invalid) {
                           setAttachmentError(`${invalid.name}: Dosya türünü veya boyutunu kontrol edin (en fazla 10 MB).`)
                           return
                         }
                         setAttachmentError("")
                         setAttachments(current => [...current, ...incoming])
                       }} />
                     {attachmentError && <p className="text-xs text-destructive" role="alert">{attachmentError}</p>}
                     {attachments.length > 0 && <ul className="space-y-1.5">
                       {attachments.map((file, index) => <li key={`${file.name}-${index}`} className="flex items-center gap-2 rounded-md border bg-muted/30 px-2 py-1.5 text-xs">
                         <Paperclip className="h-3.5 w-3.5 shrink-0 text-primary" />
                         <span className="min-w-0 flex-1 truncate">{file.name}</span>
                         <span className="text-muted-foreground">{(file.size / 1024 / 1024).toFixed(1)} MB</span>
                         <button type="button" aria-label={`${file.name} dosyasını kaldır`} className="rounded p-1 hover:bg-muted" onClick={() => setAttachments(current => current.filter((_, position) => position !== index))}><X className="h-3.5 w-3.5" /></button>
                       </li>)}
                     </ul>}
                   </div>
                  <DialogFooter>
                      <Button type="submit" disabled={!!createCapacityConflict || uploading || createMutation.isPending || leavesLoading || leavesFetching || leavesError || !leaves || !!createOverlap?.matches.length && (!createAcknowledged || createAcknowledgedSignature !== overlapSignature(createOverlap))}>{uploading ? "Belgeler yükleniyor..." : createMutation.isPending ? "Kaydediliyor..." : retrospective ? "Kullanılmış izni kaydet" : "Kaydet"}</Button>
                  </DialogFooter>
                   </fieldset>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </div>

        <LeaveCalendar leaves={leaves ?? []} loading={leavesLoading || leavesFetching && !leaves} error={leavesError} onRetry={() => { void refetchLeaves() }} />
        <div className="flex flex-col bg-card rounded-xl border shadow-sm overflow-hidden">
           <div className="p-4 border-b flex flex-wrap items-center justify-between gap-4 bg-muted/20">
             <div><h2 className="font-semibold">Bekleyen İzin Talepleri</h2><p className="text-xs text-muted-foreground">Karar bekleyen talepler</p></div>
             <div className="relative w-full sm:w-64">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Personel ara..."
                className="pl-9 h-10 bg-background"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>
          <div className="flex-1 overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-muted/95 backdrop-blur z-10">
                <TableRow>
                  <TableHead>Personel</TableHead>
                   <TableHead>İzin Türü</TableHead>
                   <TableHead>Neden</TableHead>
                  <TableHead>Tarih Aralığı</TableHead>
                  <TableHead className="text-right">Süre</TableHead>
                  <TableHead>Açıklama</TableHead>
                  <TableHead>Durum</TableHead>
                  <TableHead>Kararı Veren / Zaman</TableHead>
                  <TableHead className="text-right">İşlem</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leavesLoading ? (
                   <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">Yükleniyor...</TableCell></TableRow>
                 ) : leavesError ? (
                    <TableRow><TableCell colSpan={9} className="text-center py-8 text-destructive">İzin talepleri yüklenemedi. <Button type="button" variant="outline" size="sm" onClick={() => void refetchLeaves()}>Yeniden dene</Button></TableCell></TableRow>
                 ) : filteredLeaves.length === 0 ? (
                   <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">Kayıt bulunamadı</TableCell></TableRow>
                ) : (
                  filteredLeaves.map((leave) => (
                    <TableRow key={leave.id}>
                      <TableCell className="font-medium text-foreground">{leave.employeeName}</TableCell>
                       <TableCell><Badge variant={leave.settlementType === "debt" ? "warning" : "secondary"}>{leave.settlementType === "debt" ? "Borç İzin" : "Tam İzin"}</Badge></TableCell>
                       <TableCell>{getTypeLabel(leave.type)}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {new Date(leave.startDate).toLocaleDateString('tr-TR', { timeZone: 'UTC' })} - {new Date(leave.endDate).toLocaleDateString('tr-TR', { timeZone: 'UTC' })}
                      </TableCell>
                       <TableCell className="text-right font-medium">
                         {leave.type === "annual" && leave.settlementType === "full"
                           ? `${leave.days} gün · ${formatHours(leave.deductedAnnualHours)}`
                           : `${leave.days} gün`}
                       </TableCell>
                       <TableCell className="max-w-[200px] text-muted-foreground" title={leave.note}>
                         <p className="truncate">{leave.note || '-'}</p>
                         {leave.attachments.length > 0 && <div className="mt-1 flex flex-wrap gap-1">
                           {leave.attachments.map(file => <a key={file.id} href={`/api/leaves/${leave.id}/attachments/${file.id}`} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-40 items-center gap-1 truncate text-xs font-medium text-primary hover:underline" title={file.name}><Paperclip className="h-3 w-3 shrink-0" />{file.name}</a>)}
                         </div>}
                      </TableCell>
                      <TableCell>
                        <Badge variant={
                          leave.status === 'approved' ? 'success' : 
                          leave.status === 'rejected' ? 'destructive' : 'warning'
                        }>
                          {leave.status === 'approved' ? 'Onaylandı' : 
                           leave.status === 'rejected' ? 'Reddedildi' : 'Bekliyor'}
                        </Badge>
                        <LeaveEntryBadge leave={leave} />
                      </TableCell>
                      <TableCell className="min-w-[175px] text-sm">
                        {leave.status === "pending" ? (
                          <span className="text-muted-foreground">Henüz karar verilmedi</span>
                        ) : leave.reviewedByName && leave.reviewedAt ? (
                          <div>
                            <p className="font-medium">{leave.reviewedByName}</p>
                            <p className="text-xs text-muted-foreground">
                              {new Intl.DateTimeFormat("tr-TR", {
                                dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Istanbul",
                              }).format(new Date(leave.reviewedAt))}
                            </p>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">Eski kayıt — bilgi yok</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {leave.status === 'pending' && canManageOperations ? (
                          <div className="flex items-center justify-end gap-2">
                            <Button 
                              variant="outline" 
                              size="sm" 
                              className="h-8 border-green-200 text-green-700 hover:bg-green-50"
                              data-testid={`button-review-approve-${leave.id}`}
                                onClick={() => { setReviewLeave(leave); setReviewDecision("approved"); setReviewAcknowledged(false); void refetchLeaves() }}
                              disabled={updateStatusMutation.isPending}
                            >
                              <CheckCircle className="h-4 w-4 mr-1" /> Onayla
                            </Button>
                            <Button 
                              variant="outline" 
                              size="sm" 
                              className="h-8 border-red-200 text-red-700 hover:bg-red-50"
                              data-testid={`button-review-reject-${leave.id}`}
                                onClick={() => { setReviewLeave(leave); setReviewDecision("rejected"); setReviewAcknowledged(false); void refetchLeaves() }}
                              disabled={updateStatusMutation.isPending}
                            >
                              <XCircle className="h-4 w-4 mr-1" /> Reddet
                            </Button>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">{leave.status === "pending" ? "Onay bekliyor" : "İşlem yapıldı"}</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
        <Dialog open={!!reviewLeave && !!reviewDecision} onOpenChange={(open) => {
          if (!open && !updateStatusMutation.isPending) {
            setReviewLeave(null)
            setReviewDecision(null)
            setReviewAcknowledged(false)
          }
        }}>
          <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{reviewDecision === "approved" ? "İzin talebini onayla" : "İzin talebini reddet"}</DialogTitle>
            </DialogHeader>
            {reviewLeave && (() => {
              const summary = workDebtReport?.employeeSummaries.find((item) => item.employeeId === reviewLeave.employeeId)
              const scheduledDebit = reviewLeave.type === "annual" && reviewLeave.settlementType === "full"
              return (
                <div className="space-y-5">
                  <section className="rounded-lg border bg-muted/20 p-4">
                    <h3 className="font-semibold">{reviewLeave.employeeName}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {formatLeaveDate(reviewLeave.startDate)} – {formatLeaveDate(reviewLeave.endDate)} · {reviewLeave.days} gün · {reviewLeave.settlementType === "debt" ? "Borç izin" : "Tam izin"} · {getTypeLabel(reviewLeave.type)}
                    </p>
                    {reviewLeave.note && <p className="mt-3 whitespace-pre-wrap break-words text-sm">{reviewLeave.note}</p>}
                  </section>
                  <div><Button type="button" variant="outline" className="gap-2" onClick={() => setCalendarOpen(true)} data-testid="button-view-in-calendar"><CalendarDays className="h-4 w-4" />Takvimde görüntüle</Button></div>
                  <Dialog open={calendarOpen} onOpenChange={setCalendarOpen}>
                    <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-5xl" data-testid="dialog-review-calendar">
                      <DialogHeader><DialogTitle>Takvimde görüntüle · {reviewLeave.employeeName}</DialogTitle></DialogHeader>
                      <LeaveCalendar leaves={leaves ?? []} loading={leavesLoading || leavesFetching && !leaves} error={leavesError} onRetry={() => { void refetchLeaves() }} focus={{ leaveId: reviewLeave.id, employeeName: reviewLeave.employeeName, start: reviewLeave.startDate.slice(0, 10), end: reviewLeave.endDate.slice(0, 10) }} />
                      <DialogFooter><Button type="button" onClick={() => setCalendarOpen(false)} data-testid="button-close-review-calendar">İncelemeye dön</Button></DialogFooter>
                    </DialogContent>
                  </Dialog>
                  <LeaveOverlap summary={reviewOverlap} loading={leavesLoading || leavesFetching} error={leavesError} onRetry={() => { void refetchLeaves() }} decision={reviewDecision === "approved" ? "approved" : "rejected"} />
                  {reviewCapacityConflict && <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive" data-testid="alert-annual-capacity-review">{capacityMessage(reviewCapacityConflict)}</p>}
                  {!leavesFetching && !leavesError && !reviewStillPending && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">Bu talep artık beklemede değil veya listede bulunmuyor. Karar verilemez; pencereyi kapatıp listeyi kontrol edin.</p>}
                  {(leavesFetching || leavesError) && <p role="status" className="text-xs text-muted-foreground">İzin kontrolü tamamlanmadan karar verilemez.</p>}
                  {!!reviewOverlap?.matches.length && <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border bg-card p-3 text-sm leading-5">
                    <input type="checkbox" checked={reviewAcknowledged && reviewAcknowledgedSignature === overlapSignature(reviewOverlap)} onChange={event => { setReviewAcknowledged(event.target.checked); setReviewAcknowledgedSignature(overlapSignature(reviewOverlap)) }} className="mt-1 accent-primary" data-testid="input-acknowledge-review-overlap" />
                    <span>Çakışan izinleri ve başvuruları gördüm; {reviewDecision === "approved" ? "talebi yine de onaylamak" : "talebi yine de reddetmek"} istiyorum.</span>
                  </label>}
                  {!!reviewOverlap?.matches.length && (!reviewAcknowledged || reviewAcknowledgedSignature !== overlapSignature(reviewOverlap)) && <p role="status" className="text-xs text-amber-700 dark:text-amber-300">Karar vermek için çakışma onayını işaretleyin.</p>}

                  <section>
                    <h3 className="mb-2 text-sm font-semibold">Talebin kapsadığı yıllık izin dönemleri</h3>
                    {!scheduledDebit ? (
                      <p className="text-sm text-muted-foreground">Bu talep için yıllık izin bakiyesinden düşüm uygulanmaz.</p>
                    ) : reviewLeave.annualCycleBalances.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Talep dönemi için yıllık izin bakiyesi bulunmuyor.</p>
                    ) : (
                      <div className="space-y-3">
                        {reviewLeave.annualCycleBalances.map((cycle) => (
                          <section key={cycle.startDate} className="rounded-md border p-3">
                            <h4 className="mb-2 text-sm font-medium">
                              {formatLeaveDate(cycle.startDate)} – {formatLeaveDate(cycle.endDate)}
                            </h4>
                            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                              <div><p className="text-xs text-muted-foreground">Hak</p><p className="mt-1 text-sm font-semibold">{formatHours(cycle.entitlementHours)}</p></div>
                              <div><p className="text-xs text-muted-foreground">Kullanıldı</p><p className="mt-1 text-sm font-semibold">{formatHours(cycle.usedHours)}</p></div>
                              <div><p className="text-xs text-muted-foreground">Onay bekliyor</p><p className="mt-1 text-sm font-semibold">{formatHours(cycle.pendingHours)}</p></div>
                              <div><p className="text-xs text-muted-foreground">Kalan</p><p className="mt-1 text-sm font-semibold">{formatHours(cycle.remainingHours)}</p></div>
                            </div>
                          </section>
                        ))}
                      </div>
                    )}
                  </section>

                  {scheduledDebit && (
                    <section>
                      <div className="flex flex-wrap items-baseline justify-between gap-1">
                        <h3 className="text-sm font-semibold">Bu talebin yıllık izin düşümü</h3>
                        <span className="text-sm font-semibold text-primary">
                          {formatHours(reviewLeave.deductedAnnualHours)} · {formatDaysEquivalent(reviewLeave.deductedAnnualHours)}
                        </span>
                      </div>
                      {reviewLeave.annualHourBreakdown.length ? (
                        <ul className="mt-2 divide-y rounded-md border">
                          {reviewLeave.annualHourBreakdown.map((entry) => (
                            <li key={`${reviewLeave.id}-${entry.date}`} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                              <span>{formatLeaveDate(entry.date)}</span><span className="font-medium">{formatHours(entry.hours)}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-2 text-sm text-muted-foreground">Günlük düşüm ayrıntısı bulunmuyor.</p>
                      )}
                    </section>
                  )}

                  <section>
                    <h3 className="mb-2 text-sm font-semibold">Tüm zamanlar çalışma özeti</h3>
                    {workDebtsLoading ? (
                      <p className="text-sm text-muted-foreground" role="status">Fazla mesai ve iş borcu bilgileri yükleniyor…</p>
                    ) : workDebtsError ? (
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/30 p-3">
                        <p className="text-sm text-destructive" role="alert">Fazla mesai ve iş borcu özeti alınamadı.</p>
                        <Button type="button" variant="outline" size="sm" onClick={() => void refetchWorkDebts()}>Yeniden dene</Button>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                        <div className="rounded-md border p-3"><p className="text-xs text-muted-foreground">Tamamlanan fazla mesai</p><p className="mt-1 font-semibold">{formatHours(summary?.totalCompletedOvertimeHours ?? 0)}</p></div>
                        <div className="rounded-md border p-3"><p className="text-xs text-muted-foreground">Toplam iş borcu</p><p className="mt-1 font-semibold">{formatHours(summary?.totalDebtHours ?? 0)}</p></div>
                        <div className="rounded-md border p-3"><p className="text-xs text-muted-foreground">Kalan iş borcu</p><p className="mt-1 font-semibold">{formatHours(summary?.outstandingDebtHours ?? 0)}</p></div>
                      </div>
                    )}
                  </section>
                  <DialogFooter className="flex-col-reverse gap-2 sm:flex-row">
                    <Button type="button" variant="outline" data-testid="button-cancel-leave-review" onClick={() => { setReviewLeave(null); setReviewDecision(null) }} disabled={updateStatusMutation.isPending}>Vazgeç</Button>
                    <Button
                      type="button"
                      variant={reviewDecision === "approved" ? "default" : "destructive"}
                      data-testid="button-confirm-leave-review"
                      onClick={() => handleStatusUpdate(reviewLeave.id, reviewDecision!)}
                      disabled={!!reviewCapacityConflict || updateStatusMutation.isPending || !reviewStillPending || workDebtsLoading || workDebtsError || !workDebtReport || leavesLoading || leavesFetching || leavesError || !leaves || !!reviewOverlap?.matches.length && (!reviewAcknowledged || reviewAcknowledgedSignature !== overlapSignature(reviewOverlap))}
                    >
                      {updateStatusMutation.isPending ? "Kaydediliyor…" : reviewDecision === "approved" ? "Onayla" : "Reddet"}
                    </Button>
                  </DialogFooter>
                </div>
              )
            })()}
          </DialogContent>
        </Dialog>
        {!leavesError && <LeaveHistory leaves={leaves ?? []} loading={leavesLoading} />}
      </div>
    </Layout>
  )
}
