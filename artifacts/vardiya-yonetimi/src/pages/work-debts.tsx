import { useEffect, useMemo, useRef, useState } from "react"
import { format, parseISO } from "date-fns"
import { tr } from "date-fns/locale"
import { Link } from "wouter"
import { ArrowDownRight, ArrowUpRight, CalendarDays, ChevronDown, Clock3, Search } from "lucide-react"
import { useListDepartments, useListWorkDebts, type WorkDebtDay } from "@workspace/api-client-react"
import { Layout } from "@/components/layout"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { employeePhotoUrl } from "@/lib/employee-photo"

const numberFormat = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 })
const hours = (value: number) => `${numberFormat.format(value)} sa`
const dayLabel = (date: string) => format(parseISO(date), "d MMM yyyy", { locale: tr })
type DateMode = "all" | "range" | "single"
const todayInIstanbul = () => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date())
  const part = (type: string) => parts.find((item) => item.type === type)!.value
  return `${part("year")}-${part("month")}-${part("day")}`
}

export default function WorkDebtsPage() {
  const { data: report, isLoading, isError, refetch } = useListWorkDebts()
  const { data: departments = [] } = useListDepartments()
  const [search, setSearch] = useState("")
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<number | null>(null)
  const [isEmployeeMenuOpen, setIsEmployeeMenuOpen] = useState(false)
  const [activeEmployeeIndex, setActiveEmployeeIndex] = useState(-1)
  const employeeSearchRef = useRef<HTMLDivElement>(null)
  const employeeInputRef = useRef<HTMLInputElement>(null)
  const [department, setDepartment] = useState("all")
  const [dateMode, setDateMode] = useState<DateMode>("all")
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [selectedDate, setSelectedDate] = useState("")
  const [onlyOutstanding, setOnlyOutstanding] = useState(false)
  const [expandedWeeks, setExpandedWeeks] = useState<Record<string, boolean>>({})
  const invalidRange = dateMode === "range" && !!startDate && !!endDate && startDate > endDate
  const employees = useMemo(() => {
    const distinct = new Map<number, { id: number; name: string; department: string; photoPath: string | null }>()
    for (const day of report?.days || []) {
      if (!distinct.has(day.employeeId)) {
        distinct.set(day.employeeId, { id: day.employeeId, name: day.employeeName, department: day.department, photoPath: day.photoPath })
      }
    }
    return [...distinct.values()]
  }, [report])
  const matchingEmployees = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("tr-TR")
    if (!query) return []
    const queryTokens = query.split(/\s+/).filter(Boolean)
    const score = (name: string) => {
      const normalizedName = name.toLocaleLowerCase("tr-TR")
      const nameTokens = normalizedName.split(/\s+/)
      if (!queryTokens.every((token) => nameTokens.some((nameToken) => nameToken.includes(token)))) return null
      if (normalizedName === query) return 0
      if (normalizedName.startsWith(query)) return 1
      if (nameTokens.some((nameToken) => nameToken.startsWith(queryTokens[0]))) return 2
      return 3
    }
    return employees
      .map((employee) => ({ employee, score: score(employee.name) }))
      .filter((match): match is { employee: (typeof employees)[number]; score: number } => match.score !== null)
      .sort((a, b) => a.score - b.score || a.employee.name.localeCompare(b.employee.name, "tr"))
      .slice(0, 8)
      .map(({ employee }) => employee)
  }, [employees, search])
  const selectedEmployee = employees.find((employee) => employee.id === selectedEmployeeId)
  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (employeeSearchRef.current && !employeeSearchRef.current.contains(event.target as Node)) {
        setIsEmployeeMenuOpen(false)
      }
    }
    document.addEventListener("pointerdown", handleOutsideClick)
    return () => document.removeEventListener("pointerdown", handleOutsideClick)
  }, [])
  const filtered = useMemo(() => (report?.days || []).filter((day) => {
    if (selectedEmployeeId && day.employeeId !== selectedEmployeeId) return false
    if (department !== "all" && day.department !== department) return false
    const date = day.workDate.slice(0, 10)
    if (dateMode === "range" && (invalidRange || (startDate && date < startDate) || (endDate && date > endDate))) return false
    if (dateMode === "single" && date !== selectedDate) return false
    if (onlyOutstanding && day.outstandingHours <= 0) return false
    return true
  }), [report, selectedEmployeeId, department, dateMode, startDate, endDate, selectedDate, invalidRange, onlyOutstanding])
  const totals = useMemo(() => filtered.reduce((sum, day) => ({
    missing: sum.missing + day.missingHours,
    regular: sum.regular + day.coveredByRegularHours,
    overtime: sum.overtime + day.coveredByOvertimeHours,
    outstanding: sum.outstanding + day.outstandingHours,
  }), { missing: 0, regular: 0, overtime: 0, outstanding: 0 }), [filtered])
  const groups = useMemo(() => {
    const grouped = new Map<string, WorkDebtDay[]>()
    for (const day of filtered) grouped.set(day.weekStart, [...(grouped.get(day.weekStart) || []), day])
    return [...grouped.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([start, days]) => ({
      start, days: days.sort((a, b) => b.workDate.localeCompare(a.workDate) || a.employeeName.localeCompare(b.employeeName, "tr")),
      missing: days.reduce((sum, day) => sum + day.missingHours, 0),
      outstanding: days.reduce((sum, day) => sum + day.outstandingHours, 0),
    }))
  }, [filtered])
  const hasFilters = !!selectedEmployeeId || department !== "all" || dateMode !== "all" || onlyOutstanding
  const hasAnythingToClear = !!search || hasFilters
  const selectEmployee = (employee: (typeof employees)[number]) => {
    setSelectedEmployeeId(employee.id)
    setSearch(employee.name)
    setIsEmployeeMenuOpen(false)
    setActiveEmployeeIndex(-1)
    employeeInputRef.current?.focus()
  }
  const clearEmployee = () => {
    setSelectedEmployeeId(null)
    setSearch("")
    setIsEmployeeMenuOpen(false)
    setActiveEmployeeIndex(-1)
  }

  return (
    <Layout>
      <div className="flex-1 overflow-auto bg-background/60 px-4 py-6 sm:px-7 lg:px-10 lg:py-9">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-wrap items-end justify-between gap-5">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">Çalışma yönetimi / 02</p>
              <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">Çalışma Borçları</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Eksik çalışma, aynı haftadaki normal saat fazlası ve gerçekleşen fazla mesaiyle karşılaştırılır. Kalan borç gün bazında izlenir.</p>
            </div>
            <Link href="/overtime" className="inline-flex h-9 items-center gap-2 rounded-md border bg-card px-3 text-sm font-semibold text-primary transition-colors hover:bg-secondary" data-testid="link-work-debts-overtime"><Clock3 className="h-4 w-4" /> Fazla mesaiye git <ArrowUpRight className="h-3.5 w-3.5" /></Link>
          </div>

          {isLoading ? <div className="mt-8 space-y-4"><div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map((index) => <div key={index} className="h-28 animate-pulse rounded-xl bg-muted" />)}</div><div className="h-56 animate-pulse rounded-xl bg-muted" /></div> :
            isError ? <div className="mt-8 rounded-xl border border-destructive/20 bg-card p-10 text-center"><p className="font-bold">Borç raporu yüklenemedi.</p><p className="mt-1 text-sm text-muted-foreground">Verileri yeniden almak için tekrar deneyin.</p><Button variant="outline" className="mt-5" onClick={() => void refetch()} data-testid="button-retry-work-debts">Tekrar dene</Button></div> :
            <>
              <div className="mt-7 grid grid-cols-2 gap-3 lg:grid-cols-4">
                 <div className="rounded-xl border bg-card p-4 sm:p-5"><p className="text-xs font-semibold text-muted-foreground">Toplam eksik süre</p><p className="mt-3 font-mono text-xl font-bold tabular-nums sm:text-2xl" data-testid="text-debt-total-missing">{hours(totals.missing)}</p></div>
                 <div className="rounded-xl border bg-card p-4 sm:p-5"><p className="text-xs font-semibold text-muted-foreground">Haftalık normal saat mahsubu</p><p className="mt-3 font-mono text-xl font-bold tabular-nums text-primary sm:text-2xl" data-testid="text-debt-regular-offset">{hours(totals.regular)}</p></div>
                 <div className="rounded-xl border bg-card p-4 sm:p-5"><p className="text-xs font-semibold text-muted-foreground">Fazla mesai mahsubu</p><p className="mt-3 font-mono text-xl font-bold tabular-nums text-primary sm:text-2xl" data-testid="text-debt-overtime-offset">{hours(totals.overtime)}</p></div>
                 <div className="rounded-xl border border-primary/20 bg-secondary/70 p-4 sm:p-5"><p className="text-xs font-semibold text-secondary-foreground">Kalan çalışma borcu</p><p className="mt-3 font-mono text-xl font-bold tabular-nums text-primary sm:text-2xl" data-testid="text-debt-outstanding">{hours(totals.outstanding)}</p></div>
              </div>
              <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-primary/10 bg-secondary/40 px-4 py-3 text-xs leading-5 text-secondary-foreground"><ArrowDownRight className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><span>Hesaplama sırası: eksik saat → aynı haftanın normal çalışma fazlası → <strong>kaydedilmiş gerçekleşen</strong> fazla mesai. Yalnızca planlanan fazla mesai borcu kapatmaz.</span></div>

              <div className="mt-9 flex flex-wrap items-end justify-between gap-3">
                <div><h2 className="text-base font-bold">Günlük borç dökümü</h2><p className="mt-1 text-xs text-muted-foreground">Haftalara ayrılmış {filtered.length} günlük kayıt</p></div>
                  {hasAnythingToClear && <button type="button" className="text-xs font-semibold text-primary hover:underline" data-testid="button-clear-debt-filters" onClick={() => { clearEmployee(); setDepartment("all"); setDateMode("all"); setStartDate(""); setEndDate(""); setSelectedDate(""); setOnlyOutstanding(false) }}>Filtreleri temizle</button>}
              </div>
              <div className="mt-4 flex flex-wrap gap-2 rounded-xl border bg-card p-3 shadow-sm">
                <div className="relative min-w-[200px] flex-1" ref={employeeSearchRef}>
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    data-testid="input-search-work-debts"
                    ref={employeeInputRef}
                    className="h-9 pl-9 pr-28"
                    placeholder="Personel adına göre ara"
                    value={search}
                    role="combobox"
                    aria-label="Personel ara"
                    aria-autocomplete="list"
                    aria-expanded={isEmployeeMenuOpen}
                    aria-controls="work-debt-employee-options"
                    aria-activedescendant={isEmployeeMenuOpen && matchingEmployees[activeEmployeeIndex] ? `work-debt-employee-${matchingEmployees[activeEmployeeIndex].id}` : undefined}
                    onFocus={() => { if (search.trim()) setIsEmployeeMenuOpen(true) }}
                    onChange={(event) => {
                      setSearch(event.target.value)
                      setSelectedEmployeeId(null)
                      setActiveEmployeeIndex(-1)
                      setIsEmployeeMenuOpen(true)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        setIsEmployeeMenuOpen(false)
                      } else if (event.key === "ArrowDown" && matchingEmployees.length) {
                        event.preventDefault()
                        setIsEmployeeMenuOpen(true)
                        setActiveEmployeeIndex((current) => Math.min(current < 0 ? 0 : current + 1, matchingEmployees.length - 1))
                      } else if (event.key === "ArrowUp" && matchingEmployees.length) {
                        event.preventDefault()
                        setIsEmployeeMenuOpen(true)
                        setActiveEmployeeIndex((current) => current < 0 ? matchingEmployees.length - 1 : Math.max(current - 1, 0))
                      } else if (event.key === "Enter" && isEmployeeMenuOpen && matchingEmployees[activeEmployeeIndex]) {
                        event.preventDefault()
                        selectEmployee(matchingEmployees[activeEmployeeIndex])
                      }
                    }}
                  />
                  {selectedEmployee && <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-xs font-semibold text-primary hover:bg-secondary" aria-label="Kişi seçimini temizle" onClick={clearEmployee}>Kişiyi temizle</button>}
                  {isEmployeeMenuOpen && search.trim() && <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-lg" role="listbox" id="work-debt-employee-options">
                    {matchingEmployees.length ? matchingEmployees.map((employee, index) => (
                      <div
                        key={employee.id}
                        id={`work-debt-employee-${employee.id}`}
                        role="option"
                        aria-selected={index === activeEmployeeIndex}
                        className={`cursor-pointer rounded px-3 py-2 text-sm ${index === activeEmployeeIndex ? "bg-accent text-accent-foreground" : "hover:bg-accent/60"}`}
                        onMouseEnter={() => setActiveEmployeeIndex(index)}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => selectEmployee(employee)}
                      >
                        <span className="flex items-center gap-2.5">
                          <Avatar className="h-8 w-8 shrink-0 bg-secondary">
                            <AvatarImage src={employeePhotoUrl(employee.id, employee.photoPath)} alt="" className="object-cover" />
                            <AvatarFallback className="text-xs">{employee.name.split(" ").map((part) => part[0]).slice(0, 2).join("")}</AvatarFallback>
                          </Avatar>
                          <span><span className="block font-medium">{employee.name}</span><span className="block text-xs text-muted-foreground">{employee.department}</span></span>
                        </span>
                      </div>
                    )) : <p className="px-3 py-2 text-sm text-muted-foreground" role="status">Eşleşen personel bulunamadı.</p>}
                  </div>}
                </div>
                <select data-testid="select-debt-department" className="h-9 min-w-[150px] flex-1 rounded-md border border-input bg-background px-3 text-sm sm:flex-none" value={department} onChange={(event) => setDepartment(event.target.value)}><option value="all">Tüm departmanlar</option>{departments.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}</select>
                 <select data-testid="select-debt-date-mode" aria-label="Tarih filtresi" className="h-9 min-w-[150px] flex-1 rounded-md border border-input bg-background px-3 text-sm sm:flex-none" value={dateMode} onChange={(event) => {
                   const mode = event.target.value as DateMode
                   setDateMode(mode)
                   if (mode === "single" && !selectedDate) setSelectedDate(todayInIstanbul())
                 }}><option value="all">Tüm zamanlar</option><option value="range">Tarih aralığı</option><option value="single">Seçili tarih</option></select>
                 {dateMode === "range" && <>
                   <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">Başlangıç <Input type="date" className="h-9 w-[145px] text-foreground" value={startDate} onChange={(event) => setStartDate(event.target.value)} data-testid="input-debt-start-date" /></label>
                   <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">Bitiş <Input type="date" className="h-9 w-[145px] text-foreground" value={endDate} onChange={(event) => setEndDate(event.target.value)} data-testid="input-debt-end-date" /></label>
                 </>}
                 {dateMode === "single" && <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">Tarih <Input type="date" className="h-9 w-[145px] text-foreground" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} data-testid="input-debt-selected-date" /></label>}
                <label className="flex min-h-9 cursor-pointer items-center gap-2 rounded-md border px-3 text-xs font-semibold text-foreground hover:bg-muted"><input type="checkbox" className="h-4 w-4 accent-[hsl(var(--primary))]" data-testid="checkbox-debt-outstanding" checked={onlyOutstanding} onChange={(event) => setOnlyOutstanding(event.target.checked)} /> Yalnızca kalan borç</label>
              </div>
               {invalidRange && <p role="alert" className="mt-2 text-xs font-medium text-destructive" data-testid="text-invalid-debt-date-range">Bitiş tarihi başlangıç tarihinden önce olamaz.</p>}
               {dateMode === "single" && !selectedDate && <p className="mt-2 text-xs font-medium text-muted-foreground">Görüntülemek için bir tarih seçin.</p>}

              {groups.length === 0 ? <div className="mt-4 rounded-xl border border-dashed bg-card px-6 py-14 text-center"><CalendarDays className="mx-auto h-8 w-8 text-primary/60" /><h3 className="mt-4 font-bold">{hasFilters ? "Bu filtrelerle eşleşen kayıt yok" : "Eksik çalışma kaydı yok"}</h3><p className="mt-2 text-sm text-muted-foreground">{hasFilters ? "Filtreleri değiştirerek başka kayıtları inceleyebilirsiniz." : "Günlük çalışma kayıtlarında eksik saat oluştuğunda ayrıntılar burada görünecek."}</p></div> :
                <div className="mt-4 space-y-3">
                  {groups.map((group) => {
                    const expanded = expandedWeeks[group.start] !== false
                    return <section key={group.start} className="overflow-hidden rounded-xl border bg-card shadow-sm" data-testid={`section-debt-week-${group.start}`}>
                      <button type="button" data-testid={`button-toggle-debt-week-${group.start}`} aria-expanded={expanded} onClick={() => setExpandedWeeks((current) => ({ ...current, [group.start]: !expanded }))} className="flex w-full flex-wrap items-center justify-between gap-3 bg-muted/30 px-4 py-4 text-left transition-colors hover:bg-muted/60 sm:px-5">
                        <div className="flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary text-primary"><CalendarDays className="h-4 w-4" /></div><div><h3 className="text-sm font-bold">{dayLabel(group.start)} haftası</h3><p className="text-xs text-muted-foreground">{group.days.length} günlük kayıt</p></div></div>
                        <div className="flex items-center gap-4 text-xs sm:gap-6"><span className="hidden text-muted-foreground sm:inline">Eksik <strong className="font-mono text-foreground">{hours(group.missing)}</strong></span><span className="text-muted-foreground">Kalan <strong className="font-mono text-sm text-primary">{hours(group.outstanding)}</strong></span><ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`} /></div>
                      </button>
                      {expanded && <div className="overflow-x-auto">
                        <table className="w-full min-w-[790px] border-collapse text-sm">
                          <thead><tr className="border-y bg-muted/20 text-left text-[10px] font-bold uppercase tracking-[0.09em] text-muted-foreground"><th className="px-5 py-3 font-semibold">Personel / Departman</th><th className="px-3 py-3 font-semibold">Tarih</th><th className="px-3 py-3 text-right font-semibold">Plan</th><th className="px-3 py-3 text-right font-semibold">Gerçekleşen</th><th className="px-3 py-3 text-right font-semibold">Eksik</th><th className="px-3 py-3 text-right font-semibold">Normal mahsup</th><th className="px-3 py-3 text-right font-semibold">Mesai mahsubu</th><th className="px-5 py-3 text-right font-semibold">Kalan</th></tr></thead>
                          <tbody>{group.days.map((day) => (
                            <tr key={`${day.employeeId}-${day.workDate}`} className="border-b border-border/70 last:border-0 hover:bg-muted/20" data-testid={`row-debt-${day.employeeId}-${day.workDate}`}>
                              <td className="px-5 py-3">
                                <div className="flex items-center gap-2.5">
                                  <Avatar className="h-8 w-8 shrink-0 bg-secondary">
                                    <AvatarImage src={employeePhotoUrl(day.employeeId, day.photoPath)} alt="" className="object-cover" />
                                    <AvatarFallback className="text-xs">{day.employeeName.split(" ").map((part) => part[0]).slice(0, 2).join("")}</AvatarFallback>
                                  </Avatar>
                                  <p className="font-semibold">{day.employeeName}</p>
                                </div>
                                <p className="mt-0.5 text-xs text-muted-foreground">{day.department}</p>
                                <span className={`mt-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ${day.source === "debt_leave" ? "bg-amber-100 text-amber-900" : "bg-secondary text-secondary-foreground"}`}>
                                  {day.source === "debt_leave" ? (day.leaveStatus === "pending" ? "Borç izin · onay bekliyor" : "Borç izin") : "Eksik çalışma"}
                                </span>
                              </td>
                              <td className="whitespace-nowrap px-3 py-3 font-mono text-xs text-muted-foreground">{dayLabel(day.workDate)}</td>
                              <td className="px-3 py-3 text-right font-mono tabular-nums">{hours(day.plannedHours)}<div className="text-[11px] text-muted-foreground">{day.plannedStart && day.plannedEnd ? `${day.plannedStart}–${day.plannedEnd}` : "Saat belirtilmedi"}</div></td>
                              <td className="px-3 py-3 text-right font-mono tabular-nums">{hours(day.actualHours)}<div className="text-[11px] text-muted-foreground">{day.source === "debt_leave" ? "İzin" : day.checkIn && day.checkOut ? `${day.checkIn}–${day.checkOut}` : "Saat belirtilmedi"}</div></td>
                              <td className="px-3 py-3 text-right font-mono font-semibold tabular-nums">{hours(day.missingHours)}</td>
                              <td className="px-3 py-3 text-right font-mono tabular-nums text-primary">{day.coveredByRegularHours > 0 ? `−${hours(day.coveredByRegularHours)}` : "—"}</td>
                              <td className="px-3 py-3 text-right font-mono tabular-nums text-primary">{day.coveredByOvertimeHours > 0 ? `−${hours(day.coveredByOvertimeHours)}` : "—"}</td>
                              <td className="px-5 py-3 text-right"><span className={`inline-flex min-w-16 justify-end rounded-md px-2 py-1 font-mono font-bold tabular-nums ${day.outstandingHours > 0 ? "bg-amber-50 text-amber-800" : "bg-lime-100 text-lime-900"}`}>{hours(day.outstandingHours)}</span></td>
                            </tr>
                          ))}</tbody>
                        </table>
                      </div>}
                    </section>
                  })}
                </div>}
              <p className="mt-5 text-xs leading-5 text-muted-foreground">Toplamlar ve günlük kayıtlar seçili filtrelere göre güncellenir. Kayıtlar mahsup hesabını görebilmeniz için haftalara ayrılmıştır.</p>
            </>}
        </div>
      </div>
    </Layout>
  )
}