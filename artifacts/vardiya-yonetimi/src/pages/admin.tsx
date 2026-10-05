import { useEffect } from "react";
import { ShieldCheck, UserCheck, ArrowRight } from "lucide-react";
import { Link } from "wouter";
import { Layout } from "@/components/layout";
import { UserManagement } from "@/components/admin/user-management";
import { SecurityArea } from "@/components/admin/security-area";

export default function AdminPage() {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = "Yönetici Paneli | Biotex Watchman";
    return () => { document.title = previousTitle; };
  }, []);

  return (
    <Layout>
      <div className="flex-1 p-5 md:p-8">
        <div className="mx-auto max-w-5xl">
          <h1 className="flex items-center gap-3 text-2xl font-bold tracking-tight">
            <ShieldCheck className="h-7 w-7 text-primary" />
            Yönetici Paneli
          </h1>
          <p className="mt-2 text-muted-foreground">
            Bu bölüm yalnızca yöneticilere açıktır. İK kullanıcıları erişemez.
          </p>
          <Link href="/membership-requests" className="mt-7 flex max-w-xl items-center gap-4 rounded-xl border bg-card p-5 shadow-sm transition-colors hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <UserCheck className="h-6 w-6" />
            </span>
            <span className="flex-1">
              <span className="block text-lg font-semibold">Üyelik Onayları</span>
              <span className="mt-1 block text-sm text-muted-foreground">
                Yeni kullanıcı başvurularını inceleyin, onaylayın veya reddedin.
              </span>
            </span>
            <ArrowRight className="h-5 w-5 shrink-0 text-muted-foreground" />
          </Link>
          <div className="mt-6 space-y-6">
            <UserManagement />
            <SecurityArea />
          </div>
        </div>
      </div>
    </Layout>
  );
}