import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";

const WELCOME_KEY = "xcm_welcome_shown";
interface User { id: number; openId: string; email: string | null; name: string | null; role: string; }
interface AuthContextValue {
  apiKey: string | null;
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
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [welcomeShown, setWelcomeShown] = useState<boolean>(() => sessionStorage.getItem(WELCOME_KEY) === "true");
  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" })
      .then(async (res) => res.ok ? (await res.json()).user as User : null)
      .then((next) => setUser(next))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);
  const login = useCallback(async (key: string, options?: { onVerified?: () => void }) => {
    try {
      const res = await fetch("/api/auth/verify", { credentials: "include", headers: { Authorization: `Bearer ${key}` } });
      if (!res.ok) { const body = await res.json().catch(() => ({})); return { ok: false, error: body?.error ?? "Invalid access key" }; }
      const body = await res.json();
      options?.onVerified?.();
      await new Promise((resolve) => setTimeout(resolve, 760));
      setUser(body.user as User); setApiKey(key); return { ok: true };
    } catch { return { ok: false, error: "Cannot reach the service" }; }
  }, []);
  const logout = useCallback(() => {
    void fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    setUser(null); setApiKey(null);
  }, []);
  const dismissWelcome = useCallback(() => { sessionStorage.setItem(WELCOME_KEY, "true"); setWelcomeShown(true); }, []);
  return <AuthContext.Provider value={{ apiKey, user, loading, isAuthenticated: !!user, welcomeShown, login, logout, dismissWelcome }}>{children}</AuthContext.Provider>;
}
export function useAuth() { const ctx = useContext(AuthContext); if (!ctx) throw new Error("useAuth must be used within AuthProvider"); return ctx; }
