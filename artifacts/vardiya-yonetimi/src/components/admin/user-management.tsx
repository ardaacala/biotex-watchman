import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListManagedUsersQueryKey,
  getListMembershipRequestsQueryKey,
  useDeleteManagedUser,
  useListManagedUsers,
  useResetManagedUserPassword,
  useUpdateManagedUserRole,
  type MembershipRequest,
} from "@workspace/api-client-react";
import { AlertTriangle, KeyRound, RefreshCw, Search, Trash2, UserCog } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const roleLabel = (r: string) => (r === "manager" ? "Yönetici" : r === "hr" ? "İK" : r);
const statusMap: Record<string, { label: string; cls: string }> = {
  approved: { label: "Onaylı", cls: "bg-emerald-100 text-emerald-800" },
  pending: { label: "Onay bekliyor", cls: "bg-amber-100 text-amber-800" },
  rejected: { label: "Reddedildi", cls: "bg-red-100 text-red-800" },
};
const msg = (e: unknown) => (e instanceof Error && e.message ? e.message : "İşlem tamamlanamadı. Lütfen tekrar deneyin.");

type Action = { kind: "role" | "password" | "delete"; user: MembershipRequest } | null;

export function UserManagement() {
  const { user: me, refresh } = useAuth();
  const queryClient = useQueryClient();
  const { data, isLoading, isError, error, refetch, isFetching } = useListManagedUsers({
    query: { queryKey: getListManagedUsersQueryKey(), refetchInterval: 30000 },
  });
  const roleMut = useUpdateManagedUserRole();
  const pwMut = useResetManagedUserPassword();
  const delMut = useDeleteManagedUser();

  const [search, setSearch] = useState("");
  const [action, setAction] = useState<Action>(null);
  const [role, setRole] = useState<"manager" | "hr">("hr");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [confirmName, setConfirmName] = useState("");
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);

  const users = data ?? [];
  const approvedManagers = users.filter((u) => u.role === "manager" && u.approvalStatus === "approved").length;
  const filtered = useMemo(() => {
    const q = search.trim().toLocaleLowerCase("tr");
    if (!q) return users;
    return users.filter((u) => u.displayName.toLocaleLowerCase("tr").includes(q) || u.username.toLocaleLowerCase("tr").includes(q));
  }, [users, search]);

  const close = () => {
    if (saving) return;
    pwMut.reset();
    setAction(null); setPw(""); setPw2(""); setConfirmName(""); setFormError("");
  };
  const open = (kind: "role" | "password" | "delete", u: MembershipRequest) => {
    setNotice(""); setFormError(""); setPw(""); setPw2(""); setConfirmName("");
    setRole(u.role === "manager" ? "hr" : "manager");
    setAction({ kind, user: u });
  };
  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: getListManagedUsersQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getListMembershipRequestsQueryKey() }),
    ]);

  const isLastManager = (u: MembershipRequest) => u.role === "manager" && u.approvalStatus === "approved" && approvedManagers <= 1;

  const submit = async () => {
    if (!action || saving) return;
    const { kind, user: t } = action;
    const isSelf = t.id === me?.id;
    setFormError("");
    if (kind === "password") {
      if (pw.length < 8 || pw.length > 128) return setFormError("Şifre 8 ile 128 karakter arasında olmalıdır.");
      if (pw !== pw2) return setFormError("Şifre tekrarı eşleşmiyor.");
    }
    if (kind === "delete" && confirmName.trim() !== t.username) return setFormError("Onay için kullanıcı adını aynen yazın.");
    setSaving(true);
    try {
      if (kind === "role") {
        await roleMut.mutateAsync({ id: t.id, data: { role } });
        setNotice(`${t.displayName} artık ${roleLabel(role)}. Oturumları sonlandırıldı; yeniden giriş yapmalı.`);
      } else if (kind === "password") {
        await pwMut.mutateAsync({ id: t.id, data: { password: pw } });
        setNotice(`${t.displayName} için yeni şifre belirlendi. Oturumları sonlandırıldı; yeniden giriş yapmalı.`);
      } else {
        await delMut.mutateAsync({ id: t.id });
        setNotice(`${t.displayName} giriş hesabı silindi.`);
      }
      setPw(""); setPw2(""); setConfirmName("");
      setAction(null);
      if (kind === "password" && isSelf) {
        pwMut.reset();
        queryClient.clear();
        await refresh();
      } else {
        if (kind === "password") pwMut.reset();
        await invalidate();
      }
    } catch (e) {
      setFormError(msg(e));
    } finally {
      setSaving(false);
    }
  };

  const t = action?.user;
  const self = t?.id === me?.id;

  return (
    <section aria-labelledby="users-title" className="rounded-xl border bg-card shadow-sm">
      <div className="flex flex-col gap-3 border-b p-5 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 id="users-title" className="flex items-center gap-2 text-lg font-semibold"><UserCog className="h-5 w-5 text-primary" />Kullanıcı Hesapları</h2>
          <p className="mt-1 text-sm text-muted-foreground">Tüm üyelik hesapları, durumlarından bağımsız listelenir. Başvuru onayı için Üyelik Onayları sayfasını kullanın.</p>
        </div>
        <div className="relative w-full md:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Ad veya kullanıcı adı ara" aria-label="Kullanıcı ara" className="pl-9" data-testid="input-user-search" />
        </div>
      </div>

      {notice && <p role="status" data-testid="text-admin-notice" className="border-b bg-emerald-50 px-5 py-3 text-sm text-emerald-900">{notice}</p>}

      {isLoading ? (
        <div className="space-y-3 p-5" aria-busy="true" aria-label="Kullanıcılar yükleniyor">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
        </div>
      ) : isError ? (
        <div role="alert" className="p-8 text-center">
          <p className="font-medium">Kullanıcılar yüklenemedi.</p>
          <p className="mt-1 text-sm text-muted-foreground">{msg(error)}</p>
          <Button className="mt-4" variant="outline" onClick={() => void refetch()} data-testid="button-retry-users"><RefreshCw className="mr-2 h-4 w-4" />Tekrar dene</Button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="p-10 text-center text-sm text-muted-foreground" data-testid="text-users-empty">
          {users.length === 0 ? "Henüz kullanıcı hesabı yok." : "Aramayla eşleşen kullanıcı bulunamadı."}
          {search && <div><Button variant="link" onClick={() => setSearch("")}>Aramayı temizle</Button></div>}
        </div>
      ) : (
        <ul className={`divide-y ${isFetching ? "opacity-90" : ""}`}>
          {filtered.map((u) => {
            const isSelf = u.id === me?.id;
            const st = statusMap[u.approvalStatus] ?? { label: u.approvalStatus, cls: "bg-muted" };
            const last = isLastManager(u);
            return (
              <li key={u.id} data-testid={`row-user-${u.id}`} className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:px-5">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <div aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-secondary font-semibold">{(u.displayName[0] || "?").toUpperCase()}</div>
                  <div className="min-w-0">
                    <p className="truncate font-medium">{u.displayName}{isSelf && <span className="ml-2 text-xs font-normal text-muted-foreground">(Siz)</span>}</p>
                    <p className="truncate text-sm text-muted-foreground">@{u.username}</p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary" data-testid={`text-role-${u.id}`}>{roleLabel(u.role)}</span>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${st.cls}`} data-testid={`text-status-${u.id}`}>{st.label}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" disabled={isSelf || last} title={isSelf ? "Kendi rolünüzü değiştiremezsiniz" : last ? "Son onaylı yönetici" : undefined} onClick={() => open("role", u)} data-testid={`button-role-${u.id}`}>Rol</Button>
                  <Button size="sm" variant="outline" onClick={() => open("password", u)} data-testid={`button-password-${u.id}`}><KeyRound className="mr-1.5 h-3.5 w-3.5" />Şifre</Button>
                  <Button size="sm" variant="outline" className="text-destructive" disabled={isSelf || last} title={isSelf ? "Kendi hesabınızı silemezsiniz" : last ? "Son onaylı yönetici silinemez" : undefined} onClick={() => open("delete", u)} data-testid={`button-delete-${u.id}`}><Trash2 className="mr-1.5 h-3.5 w-3.5" />Sil</Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={!!action} onOpenChange={(o) => { if (!o) close(); }}>
        <DialogContent onInteractOutside={(e) => { if (saving) e.preventDefault(); }}>
          {action && t && (
            <form onSubmit={(e) => { e.preventDefault(); void submit(); }} className="space-y-4" autoComplete="off">
              <DialogHeader>
                <DialogTitle>{action.kind === "role" ? "Rolü değiştir" : action.kind === "password" ? "Yeni şifre belirle" : "Giriş hesabını sil"}</DialogTitle>
                <DialogDescription>{t.displayName} (@{t.username})</DialogDescription>
              </DialogHeader>

              {action.kind === "role" && (
                <fieldset className="space-y-2">
                  <legend className="mb-1 text-sm font-medium">Yeni rol</legend>
                  {(["manager", "hr"] as const).map((r) => (
                    <label key={r} className="flex cursor-pointer items-center gap-2 rounded-md border p-3 text-sm">
                      <input type="radio" name="role" checked={role === r} onChange={() => setRole(r)} disabled={saving} data-testid={`radio-role-${r}`} />
                      {roleLabel(r)}{t.role === r && <span className="text-muted-foreground">(mevcut)</span>}
                    </label>
                  ))}
                </fieldset>
              )}

              {action.kind === "password" && (
                <div className="space-y-3">
                  <label className="block text-sm font-medium">Yeni şifre
                    <Input type="password" autoComplete="new-password" minLength={8} maxLength={128} value={pw} onChange={(e) => setPw(e.target.value)} disabled={saving} className="mt-1" data-testid="input-new-password" />
                  </label>
                  <label className="block text-sm font-medium">Yeni şifre (tekrar)
                    <Input type="password" autoComplete="new-password" minLength={8} maxLength={128} value={pw2} onChange={(e) => setPw2(e.target.value)} disabled={saving} className="mt-1" data-testid="input-confirm-password" />
                  </label>
                  <p className="text-xs text-muted-foreground">8 ile 128 karakter.</p>
                </div>
              )}

              {action.kind === "delete" && (
                <div className="space-y-3 text-sm">
                  <p>Yalnızca bu kişinin site giriş hesabı ve oturumları kaldırılır. Personel kaydı, izin ve geçmiş verileri silinmez.</p>
                  <label className="block font-medium">Onaylamak için <strong>{t.username}</strong> yazın
                    <Input value={confirmName} onChange={(e) => setConfirmName(e.target.value)} disabled={saving} className="mt-1" data-testid="input-confirm-delete" />
                  </label>
                </div>
              )}

              {action.kind !== "delete" && (
                <p className="flex gap-2 rounded-md bg-amber-50 p-3 text-sm text-amber-900">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>
                    {self && action.kind === "password"
                      ? "Kendi şifrenizi değiştirirseniz oturumunuz sona erer ve yeniden giriş yapmanız gerekir."
                      : "Bu kullanıcının açık oturumları sonlandırılır; yeniden giriş yapması gerekir."}
                  </span>
                </p>
              )}

              {formError && <p role="alert" data-testid="text-form-error" className="text-sm text-destructive">{formError}</p>}

              <DialogFooter>
                <Button type="button" variant="outline" onClick={close} disabled={saving}>Vazgeç</Button>
                <Button type="submit" variant={action.kind === "delete" ? "destructive" : "default"} disabled={saving || (action.kind === "role" && role === t.role)} data-testid="button-confirm-action">
                  {saving ? "Kaydediliyor..." : action.kind === "role" ? "Rolü kaydet" : action.kind === "password" ? "Şifreyi kaydet" : "Hesabı sil"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
