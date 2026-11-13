import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";

const WELCOME_KEY = "xcm_welcome_shown";
interface User { id: number; openId: string; email: string | null; name: string | null; role: string; }
interface AuthContextValue {
  user: User | null;
  loading: boolean;
  isAuthenticated: boolean;
  welcomeShown: boolean;
  login: (key: string, options?: { onVerified?: () => void }) => Promise<{ ok: boolean; error?: string }>;
  logout: () => void;
  dismissWelcome: () => void;
}
const AuthContext = createContext<AuthContextValue | null>(null);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [welcomeShown, setWelcomeShown] = useState<boolean>(() => {
    try {
      const shown = localStorage.getItem(WELCOME_KEY) === "true" || sessionStorage.getItem(WELCOME_KEY) === "true";
      if (shown) localStorage.setItem(WELCOME_KEY, "true");
      return shown;
    } catch {
      return false;
    }
  });
  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" })
      .then(async (res) => res.ok ? (await res.json()).user as User : null)
      .then((next) => setUser(next?.role === "admin" ? next : null))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);
  const login = useCallback(async (key: string, options?: { onVerified?: () => void }) => {
    try {
      const res = await fetch("/api/auth/key-login", { method: "POST", credentials: "include", headers: { Authorization: `Bearer ${key}` } });
      if (!res.ok) { const body = await res.json().catch(() => ({})); return { ok: false, error: body?.error ?? "Invalid access key" }; }
      const body = await res.json();
      await new Promise((resolve) => setTimeout(resolve, 1400));
      options?.onVerified?.();
      await new Promise((resolve) => setTimeout(resolve, 1500));
      setUser(body.user as User); return { ok: true };
    } catch { return { ok: false, error: "Cannot reach the service" }; }
  }, []);
  const logout = useCallback(() => {
    void fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    setUser(null);
  }, []);
  const dismissWelcome = useCallback(() => {
    try { localStorage.setItem(WELCOME_KEY, "true"); } catch { /* Continue for this page session if storage is unavailable. */ }
    try { sessionStorage.setItem(WELCOME_KEY, "true"); } catch { /* Storage may be disabled by browser policy. */ }
    setWelcomeShown(true);
  }, []);
  return <AuthContext.Provider value={{ user, loading, isAuthenticated: !!user, welcomeShown, login, logout, dismissWelcome }}>{children}</AuthContext.Provider>;
}
export function useAuth() { const ctx = useContext(AuthContext); if (!ctx) throw new Error("useAuth must be used within AuthProvider"); return ctx; }
