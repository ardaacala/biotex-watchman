import { useEffect, useState } from "react"
import { Link, useLocation } from "wouter"
import { Factory, Users, Calendar, Clock, LogOut, CalendarCheck2, Building2, UserCheck, CalendarClock, ClipboardList, ChevronLeft } from "lucide-react"
import { cn } from "@/lib/utils"
import { useAuth } from "@/lib/auth"
import biotexLogo from "@/assets/biotex-logo.png"

export function Sidebar({ onLogoutRequest }: { onLogoutRequest?: () => void }) {
  const [location] = useLocation()
  const { logout, user } = useAuth()
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem("sidebar-collapsed") === "true" }
    catch { return false }
  })

  useEffect(() => {
    try { localStorage.setItem("sidebar-collapsed", String(collapsed)) }
    catch { /* The menu still works when storage is unavailable. */ }
  }, [collapsed])

  const navItems = [
    { href: "/dashboard", label: "Kontrol Paneli", icon: Factory },
    { href: "/departments", label: "Departmanlar", icon: Building2 },
    { href: "/employees", label: "Personel Yönetimi", icon: Users },
    ...(user?.role === "manager" ? [{ href: "/membership-requests", label: "Üyelik Onayları", icon: UserCheck }] : []),
    { href: "/daily-work-records", label: "Devam Takibi", icon: CalendarCheck2 },
    { href: "/schedule", label: "Vardiya Planı", icon: Calendar },
    { href: "/overtime", label: "Fazla Mesai", icon: CalendarClock },
    { href: "/work-debts", label: "Çalışma Borçları", icon: ClipboardList },
    { href: "/leaves", label: "İzin Talepleri", icon: Clock },
  ]

  return (
    <aside className={cn("relative flex w-full shrink-0 flex-col border-b bg-background md:min-h-[100dvh] md:border-b-0 md:border-r md:transition-[width] md:duration-200", collapsed ? "md:w-20" : "md:w-64")}>
      <div className={cn("flex h-16 items-center justify-between border-b px-5 md:px-4", collapsed && "md:justify-center md:px-2")}>
        <div className="flex min-w-0 items-center gap-1.5 text-lg font-bold tracking-tight text-primary">
          <img src={biotexLogo} alt="Biotex" className={cn("h-10 w-[70px] shrink-0 object-contain", collapsed && "md:h-8 md:w-14")} />
          <span className={cn("truncate text-foreground", collapsed && "md:sr-only")}>Watchman</span>
        </div>
        <button
          type="button"
          className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground md:hidden"
          aria-label="Çıkış Yap"
          data-testid="button-mobile-logout"
          onClick={() => { if (onLogoutRequest) onLogoutRequest(); else void logout() }}
        ><LogOut className="h-4 w-4" /></button>
      </div>
      <button
        type="button"
        aria-label={collapsed ? "Menüyü genişlet" : "Menüyü daralt"}
        aria-controls="primary-navigation"
        aria-expanded={!collapsed}
        title={collapsed ? "Menüyü genişlet" : "Menüyü daralt"}
        data-testid="button-toggle-sidebar"
        onClick={() => setCollapsed((current) => !current)}
        className="absolute -right-3 top-5 z-20 hidden h-6 w-6 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:flex"
      >
        <ChevronLeft className={cn("h-4 w-4 transition-transform", collapsed && "rotate-180")} />
      </button>
      
      <nav id="primary-navigation" className={cn("flex gap-1 overflow-x-auto px-3 py-2 md:block md:flex-1 md:space-y-1 md:overflow-visible", collapsed ? "md:px-2 md:py-4" : "md:p-4")}>
        {navItems.map((item) => {
          const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href))
          return (
            <Link key={item.href} href={item.href} aria-label={item.label} title={collapsed ? item.label : undefined} className={cn(
              "flex shrink-0 items-center gap-2 px-3 py-2 rounded-md text-xs font-medium whitespace-nowrap transition-colors group md:gap-3 md:py-2.5 md:text-sm",
              isActive 
                ? "bg-primary text-primary-foreground" 
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
              collapsed && "md:justify-center md:gap-0 md:px-0"
            )}>
              <item.icon className={cn("h-4 w-4 shrink-0 md:h-5 md:w-5", isActive ? "text-primary-foreground" : "text-muted-foreground group-hover:text-foreground")} />
              <span className={cn(collapsed && "md:sr-only")}>{item.label}</span>
            </Link>
          )
        })}
      </nav>

      <div className={cn("hidden border-t md:block", collapsed ? "p-2" : "p-4")}>
        <div className={cn("flex items-center gap-3 px-3 py-2 text-sm font-medium text-muted-foreground", collapsed && "gap-1 px-0")}>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary font-semibold text-foreground" aria-hidden="true">
            {(user?.displayName?.[0] || "Y").toUpperCase()}
          </div>
          <div className={cn("flex-1 overflow-hidden", collapsed && "hidden")}>
            <p className="truncate text-foreground">{user?.displayName || "İnsan Kaynakları"}</p>
            <p className="truncate text-xs opacity-70">{user?.role === "manager" ? "Yönetici" : "İK"}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              if (onLogoutRequest) onLogoutRequest()
              else void logout()
            }}
            className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Çıkış Yap"
            title="Çıkış Yap"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  )
}

export function Layout({ children, onLogoutRequest }: { children: React.ReactNode; onLogoutRequest?: () => void }) {
  return (
    <div className="flex min-h-[100dvh] flex-col bg-muted/30 md:flex-row">
      <Sidebar onLogoutRequest={onLogoutRequest} />
      <main className="min-w-0 flex-1 flex flex-col min-h-0">
        {children}
      </main>
    </div>
  )
}
