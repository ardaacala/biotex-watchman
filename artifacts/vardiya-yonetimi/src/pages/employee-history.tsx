import { useState, useMemo } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { format, startOfMonth, endOfMonth, parseISO, differenceInDays } from "date-fns"
import { useLocation } from "wouter"
import { Layout } from "@/components/layout"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { employeePhotoUrl } from "@/lib/employee-photo"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { useGetEmployeeWorkHistory, getGetEmployeeWorkHistoryQueryKey, getListWorkDebtsQueryKey, useSaveEmployeeWorkRecord, EmployeeWorkRecord } from "@workspace/api-client-react"
import { hoursFromTimes } from "@/lib/work-hours"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { ChevronLeft, Edit2, AlertCircle, FileText, Clock } from "lucide-react"
import { useToast } from "@/hooks/use-toast"

const recordSchema = z.object({
  checkIn: z.string().optional().nullable(),
  checkOut: z.string().optional().nullable(),
  actualHours: z.union([z.coerce.number().min(0).max(24), z.literal("")]).optional().nullable(),
  note: z.string().max(500, "En fazla 500 karakter").optional().nullable(),
})

type RecordFormValues = z.infer<typeof recordSchema>

export default function EmployeeHistoryPage({ id }: { id: number }) {
  const [, setLocation] = useLocation()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  
  const [dateRange, setDateRange] = useState(() => {
    const today = new Date()
    return {
      from: format(startOfMonth(today), 'yyyy-MM-dd'),
      to: format(endOfMonth(today), 'yyyy-MM-dd')
    }
  })
  
  const isDateValid = useMemo(() => {
    if (!dateRange.from || !dateRange.to) return false
    const diff = differenceInDays(parseISO(dateRange.to), parseISO(dateRange.from))
    return diff >= 0 && diff <= 366
  }, [dateRange])

  const { data: history, isLoading, isError } = useGetEmployeeWorkHistory(id, dateRange.from, dateRange.to, {
    query: { 
      enabled: isDateValid && !isNaN(id),
      queryKey: getGetEmployeeWorkHistoryQueryKey(id, dateRange.from, dateRange.to)
    }
  })

  const saveMutation = useSaveEmployeeWorkRecord()
  const [editingRecord, setEditingRecord] = useState<EmployeeWorkRecord | null>(null)

  const form = useForm<RecordFormValues>({
    resolver: zodResolver(recordSchema),
    defaultValues: { checkIn: "", checkOut: "", actualHours: "", note: "" }
  })

  const openEdit = (record: EmployeeWorkRecord) => {
    setEditingRecord(record)
    form.reset({
      checkIn: record.checkIn || "",
      checkOut: record.checkOut || "",
      actualHours: record.actualHours !== null ? record.actualHours : "",
      note: record.note || ""
    })
  }

  const onSubmit = (data: RecordFormValues) => {
    if (!editingRecord) return
    
    const cleanData = {
      checkIn: data.checkIn === "" ? null : (data.checkIn || null),
      checkOut: data.checkOut === "" ? null : (data.checkOut || null),
      actualHours: data.actualHours === "" || data.actualHours === null ? null
        : Number(data.actualHours) === editingRecord.actualHours &&
          (data.checkIn !== editingRecord.checkIn || data.checkOut !== editingRecord.checkOut)
          ? hoursFromTimes(editingRecord.plannedHours, editingRecord.plannedStart, editingRecord.plannedEnd, data.checkIn, data.checkOut)
          : Number(data.actualHours),
      note: data.note || ""
    }

    saveMutation.mutate({
      id,
      date: editingRecord.date,
      data: cleanData
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetEmployeeWorkHistoryQueryKey(id, dateRange.from, dateRange.to) })
        queryClient.invalidateQueries({ queryKey: getListWorkDebtsQueryKey() })
        setEditingRecord(null)
        toast({ title: "Kayıt güncellendi", description: `${format(parseISO(editingRecord.date), 'dd.MM.yyyy')} tarihli çalışma kaydı başarıyla kaydedildi.` })
      },
      onError: (err: any) => {
        toast({ title: "Hata", description: err?.message || "Kayıt güncellenirken bir hata oluştu.", variant: "destructive" })
      }
    })
  }

  return (
    <Layout>
      <div className="flex-1 overflow-auto p-8 flex flex-col">
        <div className="flex items-center gap-4 mb-6">
          <Button variant="outline" size="icon" onClick={() => setLocation('/employees')} title="Geri Dön">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1 flex items-center gap-4">
            {history?.employee ? (
              <>
                <Avatar className="h-12 w-12" style={{ backgroundColor: history.employee.avatarColor }}>
                  <AvatarImage src={employeePhotoUrl(history.employee.id, history.employee.photoPath)} alt={`${history.employee.name} fotoğrafı`} className="object-cover" />
                  <AvatarFallback className="bg-transparent text-white font-medium text-lg">
                    {history.employee.name.split(' ').map(n => n[0]).join('').substring(0, 2)}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <h1 className="text-2xl font-bold tracking-tight">{history.employee.name}</h1>
                  <p className="text-muted-foreground">{history.employee.department} &bull; {history.employee.role} &bull; Sicil No: <span className="font-mono">{history.employee.employeeNumber}</span></p>
                </div>
              </>
            ) : (
              <div>
                <h1 className="text-2xl font-bold tracking-tight">Çalışma Geçmişi</h1>
                <p className="text-muted-foreground">Yükleniyor...</p>
              </div>
            )}
          </div>
          
          <div className="flex items-center gap-2 bg-card p-2 rounded-lg border shadow-sm">
            <div className="flex flex-col">
              <label className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider mb-1 px-1">Başlangıç</label>
              <Input 
                type="date" 
                value={dateRange.from} 
                onChange={(e) => setDateRange(prev => ({ ...prev, from: e.target.value }))}
                className="h-8 border-none bg-muted/50 focus-visible:ring-0"
              />
            </div>
            <div className="text-muted-foreground">-</div>
            <div className="flex flex-col">
              <label className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider mb-1 px-1">Bitiş</label>
              <Input 
                type="date" 
                value={dateRange.to} 
                onChange={(e) => setDateRange(prev => ({ ...prev, to: e.target.value }))}
                className="h-8 border-none bg-muted/50 focus-visible:ring-0"
              />
            </div>
          </div>
        </div>

        {!isDateValid && (
          <div className="mb-6 p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive flex items-center gap-2 text-sm font-medium">
            <AlertCircle className="h-4 w-4" />
            Lütfen geçerli bir tarih aralığı seçin (Maksimum 366 gün).
          </div>
        )}

        {history && isDateValid && (
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="bg-card rounded-xl border shadow-sm p-4 flex flex-col justify-center">
              <div className="text-sm font-medium text-muted-foreground mb-1 flex items-center gap-2"><Clock className="h-4 w-4" /> Toplam Planlanan</div>
              <div className="text-3xl font-bold">{history.totalPlannedHours.toFixed(1).replace('.0', '')} <span className="text-lg font-normal text-muted-foreground">saat</span></div>
            </div>
            <div className="bg-card rounded-xl border shadow-sm p-4 flex flex-col justify-center">
              <div className="text-sm font-medium text-muted-foreground mb-1 flex items-center gap-2"><Clock className="h-4 w-4" /> Toplam Gerçekleşen</div>
              <div className="text-3xl font-bold">{history.totalActualHours.toFixed(1).replace('.0', '')} <span className="text-lg font-normal text-muted-foreground">saat</span></div>
            </div>
            <div className="bg-card rounded-xl border shadow-sm p-4 flex flex-col justify-center">
              <div className="text-sm font-medium text-muted-foreground mb-1 flex items-center gap-2"><AlertCircle className="h-4 w-4" /> Bakiye / Fark</div>
              <div className={`text-3xl font-bold ${history.totalActualHours - history.totalPlannedHours > 0 ? 'text-green-600 dark:text-green-500' : history.totalActualHours - history.totalPlannedHours < 0 ? 'text-red-600 dark:text-red-500' : ''}`}>
                {history.totalActualHours - history.totalPlannedHours > 0 ? '+' : ''}{(history.totalActualHours - history.totalPlannedHours).toFixed(1).replace('.0', '')} <span className="text-lg font-normal text-muted-foreground">saat</span>
              </div>
            </div>
          </div>
        )}

        <div className="flex-1 flex flex-col bg-card rounded-xl border shadow-sm overflow-hidden">
          <div className="flex-1 overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-muted/95 backdrop-blur z-10">
                <TableRow>
                  <TableHead className="w-[120px]">Tarih</TableHead>
                  <TableHead className="w-[120px]">Durum</TableHead>
                  <TableHead className="w-[140px] text-center">Giriş / Çıkış</TableHead>
                  <TableHead className="w-[120px] text-right">Planlanan</TableHead>
                  <TableHead className="w-[120px] text-right">Gerçekleşen</TableHead>
                  <TableHead className="w-[100px] text-right">Fark</TableHead>
                  <TableHead>Notlar</TableHead>
                  <TableHead className="w-[80px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && isDateValid ? (
                  <TableRow><TableCell colSpan={8} className="text-center py-8">Yükleniyor...</TableCell></TableRow>
                ) : isError ? (
                  <TableRow><TableCell colSpan={8} className="text-center py-8 text-destructive">Kayıtlar yüklenemedi</TableCell></TableRow>
                ) : !history?.records?.length ? (
                  <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Bu tarih aralığında kayıt bulunmuyor</TableCell></TableRow>
                ) : (
                  history.records.map((record) => {
                    const diff = record.actualHours !== null ? record.actualHours - record.plannedHours : 0;
                    return (
                      <TableRow key={record.date}>
                        <TableCell>
                          <div className="font-medium">{format(parseISO(record.date), 'dd.MM.yyyy')}</div>
                          <div className="text-xs text-muted-foreground">{record.dayName}</div>
                        </TableCell>
                        <TableCell>
                          {record.status === 'work' && <Badge variant="secondary" className="bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-400 hover:bg-blue-50 border-blue-200 dark:border-blue-900">Çalışma</Badge>}
                          {record.status === 'leave' && <Badge variant="secondary" className="bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-400 hover:bg-amber-50 border-amber-200 dark:border-amber-900">İzinli</Badge>}
                          {record.status === 'rest' && <Badge variant="secondary" className="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 hover:bg-slate-100 border-slate-200 dark:border-slate-700">Hafta Tatili</Badge>}
                        </TableCell>
                        <TableCell className="text-center">
                          <div className="font-mono text-sm inline-flex items-center gap-2 bg-muted/50 px-2 py-1 rounded">
                            <span>{record.checkIn || '--:--'}</span>
                            <span className="text-muted-foreground text-[10px]">-</span>
                            <span>{record.checkOut || '--:--'}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-medium text-muted-foreground">
                          {record.plannedHours.toFixed(1).replace('.0', '')}
                        </TableCell>
                        <TableCell className="text-right font-bold text-foreground">
                          {record.actualHours !== null ? record.actualHours.toFixed(1).replace('.0', '') : '-'}
                        </TableCell>
                        <TableCell className="text-right">
                          {record.actualHours !== null ? (
                            <span className={`text-sm font-bold ${diff > 0 ? 'text-green-600 dark:text-green-500' : diff < 0 ? 'text-red-600 dark:text-red-500' : 'text-muted-foreground'}`}>
                              {diff > 0 ? '+' : ''}{diff.toFixed(1).replace('.0', '')}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="text-sm truncate max-w-[200px]" title={record.note}>
                            {record.note ? (
                              <span className="flex items-center gap-1.5 text-muted-foreground"><FileText className="h-3.5 w-3.5" /> {record.note}</span>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-primary" onClick={() => openEdit(record)}>
                            <Edit2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </div>

        <Dialog open={!!editingRecord} onOpenChange={(open) => !open && setEditingRecord(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Çalışma Kaydını Düzenle</DialogTitle>
              <DialogDescription>
                {editingRecord && `${format(parseISO(editingRecord.date), 'dd.MM.yyyy')} - ${editingRecord.dayName}`}
              </DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="checkIn" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Giriş Saati</FormLabel>
                      <FormControl><Input type="time" {...field} value={field.value || ""} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="checkOut" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Çıkış Saati</FormLabel>
                      <FormControl><Input type="time" {...field} value={field.value || ""} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
                <FormField control={form.control} name="actualHours" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Gerçekleşen Çalışma Süresi (Saat)</FormLabel>
                    <FormControl><Input type="number" step="0.5" {...field} value={field.value ?? ""} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="note" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notlar</FormLabel>
                    <FormControl>
                      <textarea 
                        className="flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 resize-none"
                        rows={3} 
                        {...field} 
                        value={field.value || ""} 
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <DialogFooter>
                  <Button type="button" variant="ghost" onClick={() => setEditingRecord(null)}>İptal</Button>
                  <Button type="submit" disabled={saveMutation.isPending}>
                    {saveMutation.isPending ? "Kaydediliyor..." : "Kaydet"}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  )
}