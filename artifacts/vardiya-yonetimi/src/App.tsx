import { type FormEvent, type ReactNode, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Loader2, LockKeyhole, UserRound } from "lucide-react";
import { Redirect, Route, Router as WouterRouter, Switch, useLocation } from "wouter";
import { ErrorBoundary } from "@/components/error-boundary";
import { UpdateBanner } from "@/components/update-banner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth";
import DashboardPage from "@/pages/dashboard";
import DepartmentsPage from "@/pages/departments";
import EmployeesPage from "@/pages/employees";
import EmployeeHistoryPage from "@/pages/employee-history";
import DailyWorkRecordsPage from "@/pages/daily-work-records";
import SchedulePage from "@/pages/schedule";
import LeavesPage from "@/pages/leaves";
import MembershipRequestsPage from "@/pages/membership-requests";
import AdminPage from "@/pages/admin";
import OvertimePage from "@/pages/overtime";
import WorkDebtsPage from "@/pages/work-debts";
import NotFound from "@/pages/not-found";
import biotexLogo from "@/assets/biotex-logo.png";

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, staleTime: 1000 * 60 * 5 } },
});
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function AuthPage() {
  const { user, loading, setupRequired, refresh } = useAuth();
  const [, setLocation] = useLocation();
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [success, setSuccess] = useState("");

  if (loading) {
    return <div className="flex min-h-[100dvh] items-center justify-center bg-slate-950 text-white"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  }
  if (user) return <Redirect to="/dashboard" />;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setSuccess("");
    setSubmitting(true);
    try {
      const endpoint = setupRequired ? "api/auth/setup" : isRegistering ? "api/auth/register" : "api/auth/login";
      const response = await fetch(endpoint, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, ...((setupRequired || isRegistering) ? { displayName } : {}) }),
      });
      const data = await response.json().catch(() => ({})) as { error?: string; message?: string };
      if (!response.ok) throw new Error(data.error || "İşlem tamamlanamadı.");
      if (isRegistering) {
        setSuccess(data.message || "Başvurunuz alındı ve yönetici onayına gönderildi.");
        setIsRegistering(false);
        setPassword("");
        return;
      }
      await refresh();
      queryClient.clear();
      setLocation("/dashboard");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "İşlem tamamlanamadı.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid min-h-[100dvh] bg-[#27234f] lg:grid-cols-[1.1fr_0.9fr]">
      <section className="hidden items-center px-16 text-white lg:flex">
        <div className="max-w-xl">
          <div className="mb-10 flex items-center gap-2 text-xl font-bold"><img src={biotexLogo} alt="Biotex" className="h-12 w-[84px] object-contain" />Watchman</div>
          <p className="mb-4 text-sm font-semibold uppercase tracking-[0.22em] text-[#c4d82e]">Yönetici ve İK erişimi</p>
          <h1 className="text-5xl font-bold leading-tight">Personel bilgileri yetkili yöneticilerin kontrolünde.</h1>
          <p className="mt-6 text-lg leading-8 text-slate-300">Sisteme yalnızca üyelik başvurusu yönetici tarafından onaylanan yönetici ve İK kullanıcıları erişebilir.</p>
        </div>
      </section>
      <section className="flex items-center justify-center bg-slate-100 px-5 py-12">
        <form onSubmit={submit} className="w-full max-w-md rounded-2xl border bg-white p-8 shadow-xl">
            <div className="mb-8 lg:hidden"><div className="flex items-center gap-2 text-lg font-bold text-foreground"><img src={biotexLogo} alt="Biotex" className="h-10 w-[70px] object-contain" />Watchman</div></div>
          <div className="mb-7">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-secondary text-primary"><LockKeyhole className="h-6 w-6" /></div>
            <h2 className="text-2xl font-bold text-slate-900">{setupRequired ? "İlk yönetici hesabı" : isRegistering ? "Üyelik başvurusu" : "Yönetici girişi"}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">{setupRequired ? "Bu ekran yalnızca ilk kurulumda gösterilir." : isRegistering ? "Bilgilerinizi girin. Yönetici onayından sonra giriş yapabilirsiniz." : "Devam etmek için kullanıcı adı ve şifrenizi girin."}</p>
          </div>
          <div className="space-y-4">
            {(setupRequired || isRegistering) && <label className="block text-sm font-semibold text-slate-700">Ad soyad<Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="mt-2" autoComplete="name" required maxLength={80} /></label>}
            <label className="block text-sm font-semibold text-slate-700">Kullanıcı adı<div className="relative mt-2"><UserRound className="absolute left-3 top-3 h-4 w-4 text-slate-400" /><Input value={username} onChange={(e) => setUsername(e.target.value)} className="pl-9" autoComplete="username" required minLength={3} maxLength={32} /></div></label>
            <label className="block text-sm font-semibold text-slate-700">Şifre<Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="mt-2" autoComplete={(setupRequired || isRegistering) ? "new-password" : "current-password"} required minLength={(setupRequired || isRegistering) ? 8 : undefined} /></label>
          </div>
          {error && <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          {success && <p role="status" className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{success}</p>}
          <Button type="submit" className="mt-6 w-full" size="lg" disabled={submitting}>{submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{setupRequired ? "Yönetici hesabını oluştur" : isRegistering ? "Başvuruyu gönder" : "Giriş yap"}</Button>
          {!setupRequired && (
            <button
              type="button"
              className="mt-5 w-full text-center text-sm font-semibold text-primary hover:underline"
              onClick={() => {
                setIsRegistering((current) => !current);
                setError("");
                setSuccess("");
              }}
            >
              {isRegistering ? "Zaten hesabınız var mı? Giriş yapın" : "Hesabınız yok mu? Üyelik başvurusu yapın"}
            </button>
          )}
        </form>
      </section>
    </div>
  );
}

function ProtectedPage({ children, managerOnly = false }: { children: ReactNode; managerOnly?: boolean }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex min-h-[100dvh] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin" /></div>;
  if (!user) return <Redirect to="/" />;
  if (managerOnly && user.role !== "manager") return <Redirect to="/dashboard" />;
  return children;
}

function Router() {
  return <Switch>
    <Route path="/" component={AuthPage} />
    <Route path="/dashboard">{() => <ProtectedPage><DashboardPage /></ProtectedPage>}</Route>
    <Route path="/departments">{() => <ProtectedPage><DepartmentsPage /></ProtectedPage>}</Route>
    <Route path="/employees/:id/history">{(params) => <ProtectedPage><EmployeeHistoryPage id={Number(params.id)} /></ProtectedPage>}</Route>
    <Route path="/daily-work-records">{() => <ProtectedPage><DailyWorkRecordsPage /></ProtectedPage>}</Route>
    <Route path="/employees">{() => <ProtectedPage><EmployeesPage /></ProtectedPage>}</Route>
    <Route path="/schedule">{() => <ProtectedPage><SchedulePage /></ProtectedPage>}</Route>
    <Route path="/overtime">{() => <ProtectedPage><OvertimePage /></ProtectedPage>}</Route>
    <Route path="/work-debts">{() => <ProtectedPage><WorkDebtsPage /></ProtectedPage>}</Route>
    <Route path="/leaves">{() => <ProtectedPage><LeavesPage /></ProtectedPage>}</Route>
    <Route path="/membership-requests">{() => <ProtectedPage managerOnly><MembershipRequestsPage /></ProtectedPage>}</Route>
    <Route path="/admin">{() => <ProtectedPage managerOnly><AdminPage /></ProtectedPage>}</Route>
    <Route component={NotFound} />
  </Switch>;
}

export default function App() {
  return (
    <WouterRouter base={basePath}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <TooltipProvider>
            <UpdateBanner />
            <ErrorBoundary><Router /></ErrorBoundary>
            <Toaster />
          </TooltipProvider>
        </AuthProvider>
      </QueryClientProvider>
    </WouterRouter>
  );
}