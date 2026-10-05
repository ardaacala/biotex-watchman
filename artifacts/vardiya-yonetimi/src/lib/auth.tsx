import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";

type AuthUser = {
  id: number;
  username: string;
  displayName: string;
  role: string;
};

type AuthState = {
  user: AuthUser | null;
  loading: boolean;
  setupRequired: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [setupRequired, setSetupRequired] = useState(false);
  const queryClient = useQueryClient();
  const identity = useRef<AuthUser | null>(null);
  const requestSequence = useRef(0);

  const loadStatus = useCallback(async () => {
      const sequence = ++requestSequence.current;
      const response = await fetch(`${import.meta.env.BASE_URL}api/auth/status`, { credentials: "include", cache: "no-store" });
      if (!response.ok) throw new Error("Oturum durumu alınamadı.");
      const data = await response.json() as { user: AuthUser | null; setupRequired: boolean };
      if (sequence !== requestSequence.current) return;
      if (identity.current?.id !== data.user?.id || identity.current?.role !== data.user?.role) {
        queryClient.clear();
      }
      identity.current = data.user;
      setUser(data.user);
      setSetupRequired(data.setupRequired);
  }, [queryClient]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      await loadStatus();
    } finally {
      setLoading(false);
    }
  }, [loadStatus]);

  useEffect(() => {
    void refresh().catch(() => { /* Loading ends; a later status check can recover. */ });
    const check = () => {
      if (document.visibilityState !== "hidden") {
        void loadStatus().catch(() => { /* Network failure is not a confirmed session revocation. */ });
      }
    };
    const interval = window.setInterval(check, 30_000);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    window.addEventListener("online", check);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("online", check);
    };
  }, [refresh, loadStatus]);

  const logout = useCallback(async () => {
    const response = await fetch(`${import.meta.env.BASE_URL}api/auth/logout`, { method: "POST", credentials: "include" });
    if (!response.ok) throw new Error("Çıkış yapılamadı.");
    requestSequence.current++;
    identity.current = null;
    queryClient.clear();
    setUser(null);
  }, [queryClient]);

  const value = useMemo(
    () => ({ user, loading, setupRequired, refresh, logout }),
    [user, loading, setupRequired, refresh, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}

export function hasOperationalAccess(role: string | null | undefined): boolean {
  return role === "manager" || role === "hr";
}