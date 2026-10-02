import { Layout } from "@/components/layout"
import { useGetDashboardSummary, useListActivity } from "@workspace/api-client-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Users, Clock, CalendarOff, AlertTriangle } from "lucide-react"
import { cn } from "@/lib/utils"

export default function DashboardPage() {
  const { data: summary, isLoading: summaryLoading } = useGetDashboardSummary()
  const { data: activities, isLoading: activitiesLoading } = useListActivity()

  return (
    <Layout>
      <div className="flex-1 overflow-auto p-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight">Kontrol Paneli</h1>
          <p className="text-muted-foreground mt-1">Fabrika işgücü ve vardiya durum özeti</p>
        </div>

        {summaryLoading ? (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4 animate-pulse">
            {[...Array(4)].map((_, i) => (
              <Card key={i} className="h-32 bg-muted/50" />
            ))}
          </div>
        ) : summary ? (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4 mb-8">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Aktif Personel</CardTitle>
                <Users className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{summary.activeEmployees}</div>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Planlanan Saat</CardTitle>
                <Clock className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{summary.plannedHours} <span className="text-lg font-normal text-muted-foreground">/ {summary.targetHours}</span></div>
                <p className="text-xs text-muted-foreground mt-1">Bu haftaki hedef</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">İzindeki Personel</CardTitle>
                <CalendarOff className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{summary.employeesOnLeave}</div>
                {summary.pendingLeaveRequests > 0 && (
                  <p className="text-xs text-accent font-medium mt-1">{summary.pendingLeaveRequests} onay bekleyen talep</p>
                )}
              </CardContent>
            </Card>

            <Card className={cn(summary.deficitHours > 0 ? "border-destructive/50 bg-destructive/5" : "")}>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className={cn("text-sm font-medium", summary.deficitHours > 0 ? "text-destructive" : "text-muted-foreground")}>Eksik Mesai</CardTitle>
                <AlertTriangle className={cn("h-4 w-4", summary.deficitHours > 0 ? "text-destructive" : "text-muted-foreground")} />
              </CardHeader>
              <CardContent>
                <div className={cn("text-3xl font-bold", summary.deficitHours > 0 ? "text-destructive" : "")}>{summary.deficitHours}s</div>
              </CardContent>
            </Card>
          </div>
        ) : null}

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-7">
          <Card className="lg:col-span-4">
            <CardHeader>
              <CardTitle>Departman Dağılımı</CardTitle>
              <CardDescription>Departman bazlı çalışma saatleri ve personel sayısı</CardDescription>
            </CardHeader>
            <CardContent>
              {summaryLoading ? (
                <div className="h-64 bg-muted/50 rounded-md animate-pulse" />
              ) : summary?.departmentBreakdown ? (
                <div className="space-y-6">
                  {summary.departmentBreakdown.map((dept) => {
                    const progress = (dept.plannedHours / dept.targetHours) * 100;
                    return (
                      <div key={dept.department} className="space-y-2">
                        <div className="flex items-center justify-between text-sm">
                          <span className="font-medium">{dept.department} <span className="text-muted-foreground">({dept.employeeCount} kişi)</span></span>
                          <span className="text-muted-foreground">{dept.plannedHours}s / {dept.targetHours}s</span>
                        </div>
                        <div className="h-2 w-full bg-secondary rounded-full overflow-hidden">
                          <div 
                            className={cn(
                              "h-full transition-all rounded-full",
                              progress < 90 ? "bg-accent" : progress > 100 ? "bg-destructive" : "bg-primary"
                            )} 
                            style={{ width: `${Math.min(100, Math.max(0, progress))}%` }} 
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">Veri bulunamadı</div>
              )}
            </CardContent>
          </Card>

          <Card className="lg:col-span-3">
            <CardHeader>
              <CardTitle>Son Aktiviteler</CardTitle>
              <CardDescription>Sistemdeki son işlemler</CardDescription>
            </CardHeader>
            <CardContent>
              {activitiesLoading ? (
                <div className="space-y-4 animate-pulse">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="flex gap-4">
                      <div className="w-2 h-2 mt-2 rounded-full bg-muted" />
                      <div className="flex-1 space-y-2">
                        <div className="h-4 bg-muted rounded w-3/4" />
                        <div className="h-3 bg-muted rounded w-1/2" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : activities?.length ? (
                <div className="space-y-6">
                  {activities.map((activity) => (
                    <div key={activity.id} className="flex gap-4">
                      <div className={cn(
                        "w-2 h-2 mt-2 rounded-full flex-shrink-0",
                        activity.tone === 'blue' ? 'bg-primary' :
                        activity.tone === 'green' ? 'bg-green-500' :
                        activity.tone === 'amber' ? 'bg-accent' :
                        activity.tone === 'red' ? 'bg-destructive' : 'bg-muted-foreground'
                      )} />
                      <div className="space-y-1">
                        <p className="text-sm font-medium leading-none">{activity.title}</p>
                        <p className="text-sm text-muted-foreground">{activity.description}</p>
                        <p className="text-xs text-muted-foreground/70">
                          {new Date(activity.createdAt).toLocaleDateString('tr-TR', { 
                            day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' 
                          })}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">Aktivite bulunamadı</div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </Layout>
  )
}
