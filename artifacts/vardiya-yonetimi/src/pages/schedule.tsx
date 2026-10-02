import { useState, useMemo, useEffect, useRef } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Layout } from "@/components/layout"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { BulkScheduleEditor } from "@/components/bulk-schedule-editor"
import { useToast } from "@/hooks/use-toast"
import { 
  useListEmployees, 
  useListDepartments,
  useListDepartmentSchedules, 
  useSaveDepartmentSchedule, 
  useListSpecialPeriods, 
  useCreateSpecialPeriod, 
  useDeleteSpecialPeriod,
  getListDepartmentSchedulesQueryKey,
  getListSpecialPeriodsQueryKey,
  ScheduleDay
} from "@workspace/api-client-react"
import { Clock, CalendarDays, Plus, Trash2, Save, Calendar, Building2, ChevronRight, X, Loader2, Copy } from "lucide-react"
import { cn } from "@/lib/utils"

const DEFAULT_DAYS: ScheduleDay[] = [
  { weekday: 1, dayName: 'Pazartesi', hours: 0, plannedStart: null, plannedEnd: null },
  { weekday: 2, dayName: 'Salı', hours: 0, plannedStart: null, plannedEnd: null },
  { weekday: 3, dayName: 'Çarşamba', hours: 0, plannedStart: null, plannedEnd: null },
  { weekday: 4, dayName: 'Perşembe', hours: 0, plannedStart: null, plannedEnd: null },
  { weekday: 5, dayName: 'Cuma', hours: 0, plannedStart: null, plannedEnd: null },
  { weekday: 6, dayName: 'Cumartesi', hours: 0, plannedStart: null, plannedEnd: null },
  { weekday: 7, dayName: 'Pazar', hours: 0, plannedStart: null, plannedEnd: null },
]

function calculateHours(start: string | null, end: string | null): number | null {
  if (!start || !end) return null
  const [startHour, startMinute] = start.split(":").map(Number)
  const [endHour, endMinute] = end.split(":").map(Number)
  let minutes = (endHour * 60 + endMinute) - (startHour * 60 + startMinute)
  if (minutes < 0) minutes += 24 * 60
  return Math.round((minutes / 60) * 100) / 100
}

function getInitialSpecialPeriod(dept: string) {
  return {
    department: dept,
    name: "",
    startDate: "",
    endDate: "",
    days: DEFAULT_DAYS.map(d => ({ ...d }))
  }
}

function formatDate(dateStr: string) {
  if (!dateStr) return ""
  return new Date(dateStr).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })
}

export default function SchedulePage() {
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const { data: employees = [], isLoading: isLoadingEmployees } = useListEmployees({ status: 'active' })
  const { data: departmentList = [], isLoading: isLoadingDepartments } = useListDepartments()
  const { data: schedules = [], isLoading: isLoadingSchedules } = useListDepartmentSchedules()
  const { data: periods = [], isLoading: isLoadingPeriods } = useListSpecialPeriods()

  const saveSchedule = useSaveDepartmentSchedule()
  const createPeriod = useCreateSpecialPeriod()
  const deletePeriod = useDeleteSpecialPeriod()

  const departments = useMemo(() => {
    return departmentList.map(d => d.name).sort()
  }, [departmentList])

  const [selectedDept, setSelectedDept] = useState<string | null>(null)

  useEffect(() => {
    if (departments.length > 0 && !selectedDept) {
      setSelectedDept(departments[0])
    }
  }, [departments, selectedDept])

  const deptSchedule = useMemo(() => {
    if (!selectedDept) return null
    return schedules.find(s => s.department === selectedDept)
  }, [schedules, selectedDept])

  const deptPeriods = useMemo(() => {
    if (!selectedDept) return []
    return periods
      .filter(p => p.department === selectedDept)
      .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime())
  }, [periods, selectedDept])

  const [editedDays, setEditedDays] = useState<ScheduleDay[]>([])
  const [isBulkOpen, setIsBulkOpen] = useState(false)
  const [isPeriodBulkOpen, setIsPeriodBulkOpen] = useState(false)
  const [isCopyOpen, setIsCopyOpen] = useState(false)
  const [copySource, setCopySource] = useState("")
  const lastLoadedDept = useRef<string | null>(null)
  const lastLoadedScheduleId = useRef<number | null>(null)

  useEffect(() => {
    if (!selectedDept) return
    
    const hasChangedDept = lastLoadedDept.current !== selectedDept
    const hasChangedSchedule = deptSchedule && lastLoadedScheduleId.current !== deptSchedule.id

    if (hasChangedDept || hasChangedSchedule) {
      if (deptSchedule) {
        setEditedDays(deptSchedule.days.map(d => ({ ...d })))
        lastLoadedScheduleId.current = deptSchedule.id
      } else {
        setEditedDays(DEFAULT_DAYS.map(d => ({ ...d })))
        lastLoadedScheduleId.current = null
      }
      lastLoadedDept.current = selectedDept
    } else if (!hasChangedDept && !deptSchedule && editedDays.length === 0) {
      setEditedDays(DEFAULT_DAYS.map(d => ({ ...d })))
    }
  }, [selectedDept, deptSchedule, editedDays.length])

  const isFixedDirty = useMemo(() => {
    if (!editedDays || editedDays.length !== 7) return false
    const baseline = deptSchedule ? deptSchedule.days : DEFAULT_DAYS
    for (let i = 0; i < 7; i++) {
      if (editedDays[i]?.hours !== baseline[i]?.hours) return true
      if (editedDays[i]?.plannedStart !== baseline[i]?.plannedStart) return true
      if (editedDays[i]?.plannedEnd !== baseline[i]?.plannedEnd) return true
    }
    return false
  }, [editedDays, deptSchedule])

  const handleFixedDayHoursChange = (idx: number, val: number) => {
    const hours = Math.max(0, Math.min(24, val))
    setEditedDays(prev => {
      const next = [...prev]
      next[idx] = { ...next[idx], hours }
      return next
    })
  }

  const handleFixedDayTimeChange = (idx: number, field: 'plannedStart' | 'plannedEnd', val: string) => {
    setEditedDays(prev => {
      const next = [...prev]
      const updated = { ...next[idx], [field]: val || null }
      const calculatedHours = calculateHours(updated.plannedStart, updated.plannedEnd)
      next[idx] = { ...updated, ...(calculatedHours === null ? {} : { hours: calculatedHours }) }
      return next
    })
  }

  const handleSaveFixed = async () => {
    if (!selectedDept) return
    try {
      await saveSchedule.mutateAsync({
        data: {
          department: selectedDept,
          days: editedDays
        }
      })
      queryClient.invalidateQueries({ queryKey: getListDepartmentSchedulesQueryKey() })
      toast({ title: "Kaydedildi", description: "Vardiya düzeni başarıyla güncellendi." })
    } catch (error) {
      toast({ title: "Hata", description: "Vardiya düzeni kaydedilemedi.", variant: "destructive" })
    }
  }

  const applyBulkDays = (days: ScheduleDay[], weekdays: number[], values: { hours: number; plannedStart: string | null; plannedEnd: string | null }) =>
    days.map(day => weekdays.includes(day.weekday) ? {
      ...day,
      hours: values.hours,
      plannedStart: values.hours === 0 ? null : values.plannedStart ?? day.plannedStart,
      plannedEnd: values.hours === 0 ? null : values.plannedEnd ?? day.plannedEnd,
    } : day)

  const copySchedule = () => {
    const source = schedules.find(schedule => schedule.department === copySource && schedule.department !== selectedDept)
    if (!source) return
    setEditedDays(DEFAULT_DAYS.map(day => {
      const sourceDay = source.days.find(item => item.weekday === day.weekday)
      return sourceDay ? {
        ...day,
        hours: sourceDay.hours,
        plannedStart: sourceDay.plannedStart,
        plannedEnd: sourceDay.plannedEnd,
      } : day
    }))
    setIsBulkOpen(false)
    setIsCopyOpen(false)
    setCopySource("")
    toast({ title: "Plan taslağa kopyalandı", description: `${source.department} saatlerini ${selectedDept} için kalıcı yapmak üzere Değişiklikleri Kaydet'e basın.` })
  }

  const [isCreatingPeriod, setIsCreatingPeriod] = useState(false)
  const [newPeriod, setNewPeriod] = useState(getInitialSpecialPeriod(""))

  useEffect(() => {
    if (selectedDept) {
      setNewPeriod(getInitialSpecialPeriod(selectedDept))
      setIsCreatingPeriod(false)
    }
  }, [selectedDept])

  const handleNewPeriodDayHoursChange = (idx: number, val: number) => {
    const hours = Math.max(0, Math.min(24, val))
    setNewPeriod(prev => {
      const nextDays = [...prev.days]
      nextDays[idx] = { ...nextDays[idx], hours }
      return { ...prev, days: nextDays }
    })
  }

  const handleNewPeriodDayTimeChange = (idx: number, field: 'plannedStart' | 'plannedEnd', val: string) => {
    setNewPeriod(prev => {
      const nextDays = [...prev.days]
      const updated = { ...nextDays[idx], [field]: val || null }
      const calculatedHours = calculateHours(updated.plannedStart, updated.plannedEnd)
      nextDays[idx] = { ...updated, ...(calculatedHours === null ? {} : { hours: calculatedHours }) }
      return { ...prev, days: nextDays }
    })
  }

  const isNewPeriodValid = newPeriod.name.trim() !== "" && newPeriod.startDate !== "" && newPeriod.endDate !== ""

  const handleCreatePeriod = async () => {
    if (!isNewPeriodValid) return
    try {
      await createPeriod.mutateAsync({ data: newPeriod })
      queryClient.invalidateQueries({ queryKey: getListSpecialPeriodsQueryKey() })
      setIsCreatingPeriod(false)
      setIsPeriodBulkOpen(false)
      setNewPeriod(getInitialSpecialPeriod(selectedDept!))
      toast({ title: "Dönem Eklendi", description: "Özel çalışma dönemi oluşturuldu." })
    } catch (error) {
      toast({ title: "Hata", description: "Özel dönem oluşturulamadı.", variant: "destructive" })
    }
  }

  const handleDeletePeriod = async (id: number) => {
    if (!confirm("Bu özel dönemi silmek istediğinize emin misiniz?")) return
    try {
      await deletePeriod.mutateAsync({ id })
      queryClient.invalidateQueries({ queryKey: getListSpecialPeriodsQueryKey() })
      toast({ title: "Silindi", description: "Özel dönem kaldırıldı." })
    } catch (error) {
      toast({ title: "Hata", description: "Silinirken hata oluştu.", variant: "destructive" })
    }
  }

  if (isLoadingEmployees || isLoadingSchedules || isLoadingPeriods || isLoadingDepartments) {
    return (
      <Layout>
        <div className="flex flex-1 h-full items-center justify-center bg-muted/20">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </Layout>
    )
  }

  return (
    <Layout>
      <div className="flex h-full flex-col overflow-hidden bg-muted/20 md:flex-row">
        
        {/* Sidebar */}
        <div className="w-full shrink-0 border-r bg-card flex flex-col z-10 shadow-[1px_0_10px_rgba(0,0,0,0.02)] md:w-72">
          <div className="p-4 md:p-6 border-b flex items-center gap-3 text-primary">
            <Building2 className="w-5 h-5" />
            <h2 className="font-bold text-lg tracking-tight">Departmanlar</h2>
          </div>
          <div className="max-h-44 overflow-y-auto p-3 space-y-1 md:max-h-none md:flex-1 md:p-4">
            {departments.length === 0 ? (
              <div className="text-center p-4 text-sm text-muted-foreground">Departman bulunamadı</div>
            ) : (
              departments.map(dept => (
                <button 
                  key={dept}
                  disabled={saveSchedule.isPending}
                  onClick={() => {
                    if (dept === selectedDept) return
                    if ((isFixedDirty || isCreatingPeriod || isBulkOpen || isPeriodBulkOpen) &&
                      !window.confirm("Kaydedilmemiş çalışma düzeni değişiklikleri kaybolacak. Departman değiştirilsin mi?")) return
                    setIsBulkOpen(false)
                    setIsPeriodBulkOpen(false)
                    setSelectedDept(dept)
                  }}
                  className={cn(
                    "w-full flex items-center justify-between px-4 py-3 text-sm rounded-lg transition-all duration-200 border border-transparent",
                    selectedDept === dept 
                      ? "bg-primary text-primary-foreground font-semibold shadow-sm" 
                      : "hover:bg-muted text-foreground hover:border-border font-medium"
                  )}
                >
                  {dept}
                  <ChevronRight className={cn(
                    "w-4 h-4 transition-transform", 
                    selectedDept === dept ? "opacity-100 translate-x-1" : "opacity-30"
                  )} />
                </button>
              ))
            )}
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 overflow-y-auto relative">
          {selectedDept ? (
            <div className="p-4 md:p-10 max-w-6xl mx-auto space-y-12 pb-24">
              <header>
                <h1 className="text-2xl md:text-4xl font-extrabold tracking-tight text-foreground">{selectedDept}</h1>
                <p className="text-muted-foreground mt-2 text-sm md:text-lg">Bu departman için varsayılan mesai kurallarını ve istisnai tarih aralıklarını yönetin.</p>
              </header>
              
              {/* Fixed Schedule */}
              <section className="space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="text-xl font-bold flex items-center gap-2.5 text-foreground">
                    <Clock className="w-6 h-6 text-primary" /> 
                    Standart Çalışma Düzeni
                  </h3>
                  <Button 
                    onClick={handleSaveFixed} 
                    disabled={!isFixedDirty || saveSchedule.isPending} 
                    className="h-10 px-5 shadow-sm transition-all"
                  >
                    {saveSchedule.isPending ? "Kaydediliyor..." : <><Save className="w-4 h-4 mr-2" /> Değişiklikleri Kaydet</>}
                  </Button>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                   <Button type="button" variant="outline" onClick={() => setIsBulkOpen(open => !open)} data-testid="button-open-bulk-schedule">
                     <CalendarDays className="mr-2 h-4 w-4" /> Birden çok güne uygula
                   </Button>
                   <Button type="button" variant="outline" onClick={() => { setCopySource(""); setIsCopyOpen(true) }} disabled={schedules.every(schedule => schedule.department === selectedDept)}>
                     <Copy className="mr-2 h-4 w-4" /> Başka departmandan kopyala
                   </Button>
                   {isFixedDirty && <span className="text-xs text-amber-700 font-medium">Kaydedilmemiş değişiklikler var</span>}
                 </div>
                {isBulkOpen && <BulkScheduleEditor
                   key={`fixed-${selectedDept}`}
                   days={editedDays}
                   onCancel={() => setIsBulkOpen(false)}
                   onApply={(weekdays, values) => {
                     setEditedDays(days => applyBulkDays(days, weekdays, values))
                     setIsBulkOpen(false)
                     toast({ title: `${weekdays.length} güne uygulandı`, description: "Kalıcı olması için Değişiklikleri Kaydet'e basın." })
                   }}
                />}
                
                <div className="bg-card border rounded-xl shadow-sm p-5">
                  <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
                    {editedDays.map((day, idx) => (
                      <div key={day.weekday} className={cn("border rounded-xl p-4 flex flex-col gap-4 transition-colors", day.hours > 0 ? "bg-primary/5 border-primary/20" : "bg-muted/30")}>
                        <div className="text-center font-bold text-foreground border-b pb-2">{day.dayName}</div>
                        
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Başlangıç</label>
                          <Input 
                            type="time" 
                            value={day.plannedStart || ""}
                            onChange={(e) => handleFixedDayTimeChange(idx, 'plannedStart', e.target.value)}
                            className="h-9 w-full bg-background"
                          />
                        </div>

                        <div className="space-y-1.5">
                          <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Bitiş</label>
                          <Input 
                            type="time" 
                            value={day.plannedEnd || ""}
                            onChange={(e) => handleFixedDayTimeChange(idx, 'plannedEnd', e.target.value)}
                            className="h-9 w-full bg-background"
                          />
                        </div>

                        <div className="space-y-1.5 pt-2 border-t">
                          <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Süre (Saat)</label>
                          <Input 
                            type="number" 
                            min={0} max={24}
                            value={day.hours === 0 ? "" : day.hours}
                            placeholder="0"
                            onChange={(e) => handleFixedDayHoursChange(idx, Number(e.target.value) || 0)}
                            className="h-10 text-center font-bold text-lg bg-background"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-6 flex items-center justify-end border-t pt-5">
                     <div className="flex items-center gap-3 bg-primary/10 px-5 py-2.5 rounded-lg border border-primary/20">
                       <span className="text-sm font-bold text-primary">Haftalık Toplam:</span>
                       <span className="text-xl font-extrabold text-primary">{editedDays.reduce((acc, d) => acc + d.hours, 0)} saat</span>
                     </div>
                  </div>
                </div>
              </section>
              
              <div className="h-px bg-border/60 w-full" />
              
              {/* Special Periods */}
              <section className="space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-xl font-bold flex items-center gap-2.5 text-foreground">
                    <CalendarDays className="w-6 h-6 text-accent" /> 
                    Özel Çalışma Dönemleri
                  </h3>
                   {!isCreatingPeriod && (
                     <Button onClick={() => { setIsPeriodBulkOpen(false); setIsCreatingPeriod(true) }} variant="outline" className="h-10 px-4 border-dashed border-2 hover:border-solid bg-transparent">
                      <Plus className="w-4 h-4 mr-2" /> Yeni Dönem Ekle
                    </Button>
                  )}
                </div>

                {isCreatingPeriod && (
                  <div className="bg-card border shadow-lg rounded-xl p-6 space-y-6 animate-in fade-in slide-in-from-top-4 duration-300">
                    <div className="flex items-center justify-between border-b pb-4">
                      <h4 className="font-bold text-lg text-foreground">Yeni Dönem Tanımla</h4>
                       <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" onClick={() => { setIsPeriodBulkOpen(false); setIsCreatingPeriod(false) }}>
                        <X className="w-4 h-4"/>
                      </Button>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      <div className="space-y-2">
                        <label className="text-sm font-bold text-foreground">Dönem Adı</label>
                        <Input 
                          value={newPeriod.name} 
                          onChange={(e) => setNewPeriod(p => ({...p, name: e.target.value}))} 
                          placeholder="Örn: Yılbaşı Mesaisi" 
                          className="h-11 bg-background"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-bold text-foreground">Başlangıç Tarihi</label>
                        <Input 
                          type="date" 
                          value={newPeriod.startDate} 
                          onChange={(e) => setNewPeriod(p => ({...p, startDate: e.target.value}))} 
                          className="h-11 bg-background"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-bold text-foreground">Bitiş Tarihi</label>
                        <Input 
                          type="date" 
                          value={newPeriod.endDate} 
                          onChange={(e) => setNewPeriod(p => ({...p, endDate: e.target.value}))}
                          className="h-11 bg-background"
                        />
                      </div>
                    </div>
                    
                    <div className="space-y-3 pt-2">
                       <div className="flex flex-wrap items-center justify-between gap-2">
                         <span className="text-sm font-bold text-foreground">Bu Tarihlerdeki Çalışma Düzeni</span>
                         <Button type="button" variant="outline" size="sm" onClick={() => setIsPeriodBulkOpen(open => !open)}>
                           <CalendarDays className="mr-2 h-4 w-4" /> Birden çok güne uygula
                         </Button>
                       </div>
                       {isPeriodBulkOpen && <BulkScheduleEditor
                         key={`period-${selectedDept}`}
                         days={newPeriod.days}
                         onCancel={() => setIsPeriodBulkOpen(false)}
                         onApply={(weekdays, values) => {
                           setNewPeriod(period => ({ ...period, days: applyBulkDays(period.days, weekdays, values) }))
                           setIsPeriodBulkOpen(false)
                         }}
                       />}
                      <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
                        {newPeriod.days.map((day, idx) => (
                          <div key={day.weekday} className={cn("border rounded-xl p-3 flex flex-col gap-3 transition-colors bg-background", day.hours > 0 ? "border-primary/30" : "border-border/50")}>
                            <div className="text-center font-bold text-foreground border-b pb-2 text-sm">{day.dayName}</div>
                            
                            <div className="space-y-1">
                              <label className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider">Başlangıç</label>
                              <Input 
                                type="time" 
                                value={day.plannedStart || ""}
                                onChange={(e) => handleNewPeriodDayTimeChange(idx, 'plannedStart', e.target.value)}
                                className="h-8 text-xs"
                              />
                            </div>

                            <div className="space-y-1">
                              <label className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider">Bitiş</label>
                              <Input 
                                type="time" 
                                value={day.plannedEnd || ""}
                                onChange={(e) => handleNewPeriodDayTimeChange(idx, 'plannedEnd', e.target.value)}
                                className="h-8 text-xs"
                              />
                            </div>

                            <div className="space-y-1 pt-2 border-t">
                              <label className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider">Süre (Saat)</label>
                              <Input 
                                type="number" 
                                min={0} max={24}
                                value={day.hours === 0 ? "" : day.hours}
                                placeholder="0"
                                onChange={(e) => handleNewPeriodDayHoursChange(idx, Number(e.target.value) || 0)}
                                className="h-9 text-center font-bold text-sm"
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    
                    <div className="flex justify-end gap-3 pt-4 border-t">
                       <Button variant="ghost" onClick={() => { setIsPeriodBulkOpen(false); setIsCreatingPeriod(false) }} className="h-10">İptal</Button>
                      <Button onClick={handleCreatePeriod} disabled={!isNewPeriodValid || createPeriod.isPending} className="h-10 px-6">
                        {createPeriod.isPending ? "Ekleniyor..." : "Dönemi Ekle"}
                      </Button>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 gap-4">
                  {deptPeriods.length === 0 && !isCreatingPeriod && (
                    <div className="flex flex-col items-center justify-center p-12 border-2 border-dashed rounded-xl text-muted-foreground bg-muted/10">
                      <CalendarDays className="w-10 h-10 mb-4 opacity-20" />
                      <p className="font-medium text-foreground/70">Özel dönem bulunmuyor</p>
                      <p className="text-sm mt-1">İstisnai mesai günleri eklemek için yeni dönem oluşturun.</p>
                    </div>
                  )}
                  {deptPeriods.map(period => (
                    <div key={period.id} className="bg-card border rounded-xl p-6 flex flex-col gap-5 hover:shadow-md transition-shadow group">
                      <div className="flex items-start justify-between">
                        <div>
                          <h4 className="font-extrabold text-foreground text-xl tracking-tight">{period.name}</h4>
                          <div className="text-sm text-primary font-medium flex items-center gap-2 mt-2 bg-primary/10 w-fit px-3 py-1 rounded-full border border-primary/20">
                            <Calendar className="w-4 h-4" />
                            {formatDate(period.startDate)} &mdash; {formatDate(period.endDate)}
                          </div>
                        </div>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-opacity rounded-full" 
                          onClick={() => handleDeletePeriod(period.id)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                      
                      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
                        {period.days.map(d => (
                          <div key={d.weekday} className={cn("border rounded-xl p-3 flex flex-col items-center justify-center gap-1.5", d.hours > 0 ? "bg-primary/5 border-primary/20" : "bg-muted/20")}>
                            <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">{d.dayName.slice(0,3)}</span>
                            <span className="font-bold text-2xl text-foreground">{d.hours > 0 ? d.hours : "-"}</span>
                            {d.hours > 0 && (
                              <span className="text-[10px] font-medium text-muted-foreground whitespace-nowrap bg-background px-2 py-0.5 rounded-md border border-border/50">
                                {d.plannedStart || "?"} - {d.plannedEnd || "?"}
                              </span>
                            )}
                          </div>
                        ))}
                        <div className="border-2 border-accent/30 rounded-xl p-3 flex flex-col items-center bg-accent/5 justify-center gap-1.5 shadow-sm">
                          <span className="text-[10px] uppercase tracking-widest text-accent font-bold">TOPLAM</span>
                          <span className="font-extrabold text-2xl text-accent">{period.totalHours}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-muted-foreground bg-muted/10">
              <Building2 className="w-16 h-16 mb-4 opacity-10" />
              <p className="text-lg font-medium">Yönetmek için sol menüden departman seçiniz</p>
            </div>
          )}
        </div>
      </div>
      <Dialog open={isCopyOpen} onOpenChange={setIsCopyOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Başka departmandan saatleri kopyala</DialogTitle>
            <DialogDescription>
              Kaydedilmiş standart haftalık planı {selectedDept} departmanına taslak olarak alır.
              {isFixedDirty ? " Hedefteki kaydedilmemiş değişikliklerin yerini alır." : ""}
              {" "}Kaynak departman değişmez; sonucu kaydetmeniz gerekir.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label htmlFor="copy-source" className="text-sm font-medium">Kaynak departman</label>
            <Select value={copySource} onValueChange={setCopySource}>
              <SelectTrigger id="copy-source" aria-label="Kaynak departman seç"><SelectValue placeholder="Departman seçin" /></SelectTrigger>
              <SelectContent>
                {schedules.filter(schedule => schedule.department !== selectedDept).map(schedule =>
                  <SelectItem key={schedule.department} value={schedule.department}>{schedule.department} · {schedule.totalHours} saat/hafta</SelectItem>
                )}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Yalnız kayıtlı standart planı bulunan departmanlar gösterilir; özel dönemler kopyalanmaz.</p>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setIsCopyOpen(false)}>Vazgeç</Button>
            <Button type="button" disabled={!copySource || saveSchedule.isPending} onClick={copySchedule}>Saatleri taslağa kopyala</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <style dangerouslySetInnerHTML={{__html: `
        .hide-arrows::-webkit-outer-spin-button,
        .hide-arrows::-webkit-inner-spin-button {
          -webkit-appearance: none;
          margin: 0;
        }
        .hide-arrows {
          -moz-appearance: textfield;
        }
      `}} />
    </Layout>
  )
}
