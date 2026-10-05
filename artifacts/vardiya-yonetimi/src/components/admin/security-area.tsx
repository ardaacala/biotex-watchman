import { Lock } from "lucide-react";

export function SecurityArea() {
  return (
    <section aria-labelledby="security-title" className="rounded-xl border border-dashed bg-card p-6" data-testid="section-security">
      <h2 id="security-title" className="flex items-center gap-2 text-lg font-semibold"><Lock className="h-5 w-5 text-primary" />Güvenlik</h2>
      <p className="mt-2 text-sm text-muted-foreground">Henüz eklenmiş bir güvenlik özelliği yok. Gelecekteki güvenlik araçları burada listelenecek.</p>
    </section>
  );
}
