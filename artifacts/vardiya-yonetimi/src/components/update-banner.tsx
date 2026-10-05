import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isNewVersion } from "@/lib/app-version";

export function UpdateBanner() {
  const [nextVersion, setNextVersion] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    let activeRequest: AbortController | null = null;

    async function checkVersion() {
      if (document.visibilityState === "hidden" || activeRequest) return;
      const controller = new AbortController();
      activeRequest = controller;
      const timeout = window.setTimeout(() => controller.abort(), 10_000);
      try {
        const url = new URL(`${import.meta.env.BASE_URL}version.json`, window.location.origin);
        url.searchParams.set("check", String(Date.now()));
        const response = await fetch(url, { cache: "no-store", signal: controller.signal });
        if (!response.ok) return;
        const value: unknown = await response.json();
        if (!stopped && isNewVersion(value, __APP_VERSION__)) {
          setNextVersion(value.version);
        }
      } catch {
        // Offline/failed checks do not mean a release exists; retry on the next check.
      } finally {
        window.clearTimeout(timeout);
        activeRequest = null;
      }
    }

    void checkVersion();
    const timer = window.setInterval(() => { void checkVersion(); }, 60_000);
    const check = () => { void checkVersion(); };
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    window.addEventListener("online", check);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
      window.removeEventListener("online", check);
      activeRequest?.abort();
    };
  }, []);

  if (!nextVersion) return null;

  function reload() {
    // A version-specific URL bypasses cached HTML while retaining the current page.
    const url = new URL(window.location.href);
    url.searchParams.set("_app_version", nextVersion!);
    window.location.replace(url.href);
  }

  return (
    <div role="status" aria-live="polite" className="sticky top-0 z-50 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 border-b border-primary/20 bg-secondary px-4 py-3 text-secondary-foreground shadow-sm">
      <p className="text-sm font-medium">
        Yeni bir sürüm hazır. Kaydedilmemiş değişikliklerinizi kaydettikten sonra sayfayı yenileyin.
      </p>
      <Button type="button" size="sm" onClick={reload}>
        <RefreshCw className="mr-2 h-4 w-4" />
        Sayfayı yenile
      </Button>
    </div>
  );
}