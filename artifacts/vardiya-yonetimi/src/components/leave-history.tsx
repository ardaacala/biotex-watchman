import { useMemo, useState } from "react"
import type { Leave } from "@workspace/api-client-react"
import { CalendarDays, Check, ChevronDown, ChevronsUpDown, FileText, Search, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

type HistoryLeave = Leave & {
  employeeNumber?: string | null
}

type LeaveHistoryProps = {
  leaves: HistoryLeave[]
  loading: boolean
}

const leaveTypes: Record<string, string> = {
  annual: "Yıllık izin",
  sick: "Hastalık raporu",
  unpaid: "Ücretsiz izin",
  other: "Mazeret izni",
}

function formatDate(value: string) {
  const date = new Date(value.length === 10 ? `${value}T12:00:00Z` : value)
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(date)
}

function formatDecisionDate(value: string | null) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("tr-TR", {
        dateStyle: "long",
        timeStyle: "short",
        timeZone: "Europe/Istanbul",
      }).format(date)
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toLocaleString("tr-TR", { maximumFractionDigits: 1 })} KB`
  return `${(bytes / (1024 * 1024)).toLocaleString("tr-TR", { maximumFractionDigits: 1 })} MB`
}

const numberFormat = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 })
const formatHours = (value: number) => `${numberFormat.format(value)} saat`

export function LeaveHistory({ leaves, loading }: LeaveHistoryProps) {
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<number | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [expandedId, setExpandedId] = useState<number | null>(null)

  const decidedLeaves = useMemo(
    () =>
      leaves
        .filter((leave) => leave.status === "approved" || leave.status === "rejected")
        .sort((a, b) => {
          const aTime = Date.parse(a.reviewedAt || a.endDate || a.startDate) || 0
          const bTime = Date.parse(b.reviewedAt || b.endDate || b.startDate) || 0
          return bTime - aTime || b.id - a.id
        }),
    [leaves],
  )

  const people = useMemo(() => {
    const unique = new Map<number, { id: number; name: string; number?: string | null }>()
    for (const leave of decidedLeaves) {
      const existing = unique.get(leave.employeeId)
      if (!existing || (!existing.number && leave.employeeNumber)) {
        unique.set(leave.employeeId, {
          id: leave.employeeId,
          name: leave.employeeName,
          number: leave.employeeNumber,
        })
      }
    }
    return Array.from(unique.values()).sort((a, b) => a.name.localeCompare(b.name, "tr"))
  }, [decidedLeaves])

  const selectedPerson = people.find((person) => person.id === selectedEmployeeId)
  const visibleLeaves = selectedEmployeeId === null
    ? decidedLeaves
    : decidedLeaves.filter((leave) => leave.employeeId === selectedEmployeeId)

  return (
    <section aria-labelledby="leave-history-title" className="overflow-hidden rounded-xl border bg-card shadow-sm">
      <div className="flex flex-col gap-4 border-b bg-muted/20 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div>
          <h2 id="leave-history-title" className="text-lg font-semibold tracking-tight text-foreground">
            Geçmiş İzin Talepleri
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Karara bağlanan talepler ve ekli belgeler
          </p>
        </div>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                role="combobox"
                aria-expanded={pickerOpen}
                aria-label="Geçmiş izinlerde personel seçin"
                data-testid="button-history-person-picker"
                className="min-w-0 flex-1 justify-between gap-3 bg-background font-normal sm:w-64 sm:flex-none"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="truncate">{selectedPerson?.name ?? "Personel ara veya seç"}</span>
                </span>
                <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[min(22rem,calc(100vw-2rem))] p-0">
              <Command>
                <CommandInput
                  placeholder="İsim veya sicil numarası ara..."
                  aria-label="İsim veya sicil numarası ara"
                  data-testid="input-history-person-search"
                />
                <CommandList>
                  <CommandEmpty>Personel bulunamadı.</CommandEmpty>
                  {people.map((person) => (
                    <CommandItem
                      key={person.id}
                      value={`${person.name} ${person.number ?? ""}`}
                      onSelect={() => {
                        setSelectedEmployeeId(person.id)
                        setExpandedId(null)
                        setPickerOpen(false)
                      }}
                      data-testid={`option-history-person-${person.id}`}
                    >
                      <Check className={`h-4 w-4 shrink-0 ${selectedEmployeeId === person.id ? "opacity-100" : "opacity-0"}`} aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate">{person.name}</span>
                      {person.number && <span className="shrink-0 text-xs text-muted-foreground">{person.number}</span>}
                    </CommandItem>
                  ))}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
          {selectedEmployeeId !== null && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => {
                setSelectedEmployeeId(null)
                setExpandedId(null)
              }}
              aria-label="Personel filtresini temizle"
              title="Filtreyi temizle"
              data-testid="button-clear-history-person"
              className="shrink-0"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="divide-y" role="status" aria-label="Geçmiş izin talepleri yükleniyor" data-testid="status-history-loading">
          {[0, 1, 2].map((item) => (
            <div key={item} className="flex items-center gap-4 px-5 py-5 sm:px-6">
              <div className="h-9 w-9 shrink-0 animate-pulse rounded-lg bg-muted" />
              <div className="flex-1 space-y-2">
                <div className="h-3.5 w-36 animate-pulse rounded bg-muted" />
                <div className="h-3 w-52 max-w-full animate-pulse rounded bg-muted" />
              </div>
              <div className="h-6 w-20 animate-pulse rounded bg-muted" />
            </div>
          ))}
          <span className="sr-only">Yükleniyor...</span>
        </div>
      ) : visibleLeaves.length === 0 ? (
        <div className="flex flex-col items-center px-5 py-14 text-center" data-testid="status-history-empty">
          <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-secondary text-secondary-foreground">
            <CalendarDays className="h-5 w-5" aria-hidden="true" />
          </div>
          <p className="font-medium text-foreground">
            {selectedEmployeeId !== null ? "Bu personele ait karar bulunamadı" : "Henüz karara bağlanan izin yok"}
          </p>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            {selectedEmployeeId !== null
              ? "Başka bir personel seçin veya filtreyi temizleyerek tüm geçmişi görüntüleyin."
              : "Onaylanan ve reddedilen talepler burada, belgeleriyle birlikte listelenecek."}
          </p>
          {selectedEmployeeId !== null && (
            <Button type="button" variant="outline" size="sm" className="mt-5" onClick={() => setSelectedEmployeeId(null)} data-testid="button-reset-history-empty">
              Tüm geçmişi göster
            </Button>
          )}
        </div>
      ) : (
        <div className="divide-y">
          {visibleLeaves.map((leave) => {
            const expanded = expandedId === leave.id
            const approved = leave.status === "approved"
            const detailsId = `leave-history-details-${leave.id}`
            const attachments = leave.attachments ?? []

            return (
              <div key={leave.id} data-testid={`row-history-leave-${leave.id}`}>
                <button
                  type="button"
                  aria-expanded={expanded}
                  aria-controls={detailsId}
                  aria-label={`${leave.employeeName}, ${leaveTypes[leave.type] ?? leave.type}, ${approved ? "onaylandı" : "reddedildi"}. Ayrıntıları ${expanded ? "kapat" : "aç"}`}
                  data-testid={`button-expand-history-${leave.id}`}
                  onClick={() => setExpandedId(expanded ? null : leave.id)}
                  className="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:gap-5 sm:px-6"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
                    <CalendarDays className="h-[18px] w-[18px]" aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1 sm:grid sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] sm:items-center sm:gap-4">
                    <div className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-foreground" data-testid={`text-history-person-${leave.id}`}>{leave.employeeName}</span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">{leaveTypes[leave.type] ?? leave.type} · {leave.settlementType === "debt" ? "Borç izin" : "Tam izin"}</span>
                    </div>
                    <span className="mt-1 block text-xs text-muted-foreground sm:mt-0 sm:text-sm">
                      {formatDate(leave.startDate)} – {formatDate(leave.endDate)}
                      <span className="block sm:inline"> · {leave.days} gün{leave.type === "annual" && leave.settlementType === "full" ? ` · ${leave.deductedAnnualHours === undefined ? "saat bilgisi yok" : formatHours(leave.deductedAnnualHours)}` : ""}</span>
                    </span>
                  </div>
                  <Badge variant={approved ? "success" : "destructive"} className="shrink-0">
                    {approved ? "Onaylandı" : "Reddedildi"}
                  </Badge>
                  <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ${expanded ? "rotate-180" : ""}`} aria-hidden="true" />
                </button>

                {expanded && (
                  <div id={detailsId} className="border-t bg-muted/15 px-5 py-5 sm:pl-[5.25rem] sm:pr-6" data-testid={`details-history-leave-${leave.id}`}>
                    <div className="grid gap-6 sm:grid-cols-[minmax(0,1.4fr)_minmax(12rem,1fr)]">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Gerekçe / açıklama</p>
                        <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-foreground" data-testid={`text-history-note-${leave.id}`}>
                          {leave.note?.trim() || "Açıklama eklenmemiş."}
                        </p>
                      </div>
                      <div className="space-y-4">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Karar</p>
                          <p className="mt-2 text-sm font-medium text-foreground" data-testid={`text-history-status-${leave.id}`}>
                            {approved ? "Onaylandı" : "Reddedildi"}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Kararı veren / zaman</p>
                          <p className="mt-2 text-sm text-foreground" data-testid={`text-history-reviewer-${leave.id}`}>
                            {leave.reviewedByName || "Kararı veren belirtilmemiş"}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground" data-testid={`text-history-reviewed-at-${leave.id}`}>
                            {formatDecisionDate(leave.reviewedAt) ?? "Karar zamanı belirtilmemiş"}
                          </p>
                        </div>
                      </div>
                    </div>
                    {leave.type === "annual" && leave.settlementType === "full" && (
                      <div className="mt-6 border-t pt-5">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Yıllık izin saat dökümü</p>
                          <p className="text-sm font-semibold">{leave.deductedAnnualHours === undefined ? "Saat bilgisi yok" : formatHours(leave.deductedAnnualHours)}</p>
                        </div>
                        {leave.annualHourBreakdown?.length ? (
                          <ul className="mt-2 divide-y rounded-md border">
                            {leave.annualHourBreakdown.map((entry) => (
                              <li key={`${leave.id}-${entry.date}`} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                                <span>{formatDate(entry.date)}</span><span className="font-medium">{formatHours(entry.hours)}</span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="mt-2 text-sm text-muted-foreground">Günlük saat dökümü bulunmuyor.</p>
                        )}
                      </div>
                    )}
                    <div className="mt-6 border-t pt-5">
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Ekli belgeler</p>
                      {attachments.length === 0 ? (
                        <p className="mt-2 text-sm text-muted-foreground" data-testid={`status-history-no-attachments-${leave.id}`}>Bu talebe belge eklenmemiş.</p>
                      ) : (
                        <ul className="mt-3 flex flex-col gap-2">
                          {attachments.map((attachment) => (
                            <li key={attachment.id}>
                              <a
                                href={`/api/leaves/${encodeURIComponent(leave.id)}/attachments/${encodeURIComponent(attachment.id)}`}
                                download={attachment.name}
                                title={`${attachment.name} dosyasını indir`}
                                data-testid={`link-history-attachment-${leave.id}-${attachment.id}`}
                                className="inline-flex max-w-full items-center gap-2 rounded-md text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              >
                                <FileText className="h-4 w-4 shrink-0" aria-hidden="true" />
                                <span className="truncate">{attachment.name}</span>
                                <span className="shrink-0 text-xs font-normal text-muted-foreground">({formatSize(attachment.size)})</span>
                              </a>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}