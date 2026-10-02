import { AlertTriangle, CheckCircle2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { formatDay, type OccupancyLeave, type overlapSummary } from "@/lib/leave-occupancy"

type Summary = NonNullable<ReturnType<typeof overlapSummary>>

export function LeaveOverlap({ summary, loading, error, onRetry, decision }: {
  summary: Summary | null
  loading: boolean
  error: boolean
  onRetry: () => void
  decision: "create" | "approved" | "rejected"
}) {
  if (loading) return <div role="status" className="rounded-lg border p-4 space-y-2"><div className="h-4 w-44 animate-pulse rounded bg-muted" /><div className="h-3 w-64 max-w-full animate-pulse rounded bg-muted" /><span className="sr-only">Çakışmalar yükleniyor</span></div>
  if (error) return <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"><p>İzin çakışmaları alınamadı. İşleme devam etmeden verileri yenileyin.</p><Button type="button" size="sm" variant="outline" className="mt-2" onClick={onRetry}>Yeniden dene</Button></div>
  if (!summary) return <p className="rounded-lg bg-muted/40 p-3 text-sm text-muted-foreground">Çakışmaları görmek için geçerli bir tarih aralığı seçin.</p>
  const hasOverlap = summary.matches.length > 0
  return <section role={hasOverlap ? "alert" : "status"} aria-label="İzin çakışması özeti" data-testid="status-leave-overlap" className={`rounded-lg border p-3.5 text-sm ${hasOverlap ? "border-amber-300/70 bg-amber-50/70 text-amber-950 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-100" : "border-border bg-muted/30"}`}>
    <div className="flex items-start gap-2.5">
      {hasOverlap ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />}
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{hasOverlap ? "Seçilen tarihlerde izin çakışması var" : "Seçilen tarihlerde başka izin yok"}</p>
        <p className="mt-1 text-xs opacity-80">Aralık boyunca toplam {summary.distinctPeople} farklı kişi · Aynı kişi birden fazla kayıtta yalnızca bir kez sayılır.</p>
        <p className="mt-1 leading-5">İzinde (onaylı): <strong>{summary.approved.length} kişi</strong>{summary.approved.length ? ` · ${summary.approved.map((p) => p.name).join(", ")}` : ""}</p>
        <p className="leading-5">Başvuru (bekleyen, henüz izinde değil): <strong>{summary.pending.length} kişi</strong>{summary.pending.length ? ` · ${summary.pending.map((p) => p.name).join(", ")}` : ""}</p>
        {hasOverlap && <>
          <p className="mt-2 font-medium">{decision === "approved" ? "Onaylarsanız bu kişilerle aynı tarihlerde izin oluşacak." : decision === "rejected" ? "Reddetmeden önce aynı tarihlere denk gelen talepleri inceleyin." : "Talebi göndermeden önce aynı tarihlerdeki izinleri inceleyin."}</p>
          <ul className="mt-2 space-y-1 border-t border-current/15 pt-2">
            {summary.matches.map((leave: OccupancyLeave) => <li key={leave.id} className="leading-5" data-testid={`text-overlap-leave-${leave.id}`}>
              <strong>{leave.employeeName}</strong> · {leave.status === "approved" ? "Onaylı izin" : "Bekleyen başvuru"} · {formatDay(leave.startDate)} – {formatDay(leave.endDate)}
            </li>)}
          </ul>
        </>}
      </div>
    </div>
  </section>
}