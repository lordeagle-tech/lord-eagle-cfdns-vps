import { Router as WouterRouter, Switch, Route, Redirect, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useEffect } from "react";
import { AuthProvider, useAuth } from "@/contexts/auth-context";
import { WelcomeModal } from "@/components/welcome-modal";
import { Navbar } from "@/components/navbar";
import LoginPage from "@/pages/login";
import HomePage from "@/pages/home";
import FileManager from "@/pages/file-manager";
import DevPage from "@/pages/dev";
import TermsPage from "@/pages/terms";
import Pm2DetailPage from "@/pages/pm2-detail";
import SettingsPage from "@/pages/settings";
import DnsPage from "@/pages/dns";
import ConnectionsPage from "@/pages/connections";
import RemoteTerminalPage from "@/pages/remote-terminal";
import RemoteFilesPage from "@/pages/remote-files";
import GithubControlPage from "@/pages/github-control";
import DeployScriptPage from "@/pages/deploy-script";
import FirewallPage from "@/pages/firewall";
import PortsPage from "@/pages/ports";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 5000 },
  },
});

function ThemeSetter() {
  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);
  return null;
}

function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, loading } = useAuth();
  const [location] = useLocation();

  if (loading) { return <div className="min-h-full bg-[#0b0b0c]" />; }
  if (!isAuthenticated) {
    return <Redirect to="/login" />;
  }

  return (
    <div className="dashboard-theme flex flex-col overflow-hidden" style={{ height: "100dvh" }}>
      <Navbar />
      <main className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {children}
      </main>
      <WelcomeModal />
    </div>
  );
}

function AppRoutes() {
  const { isAuthenticated } = useAuth();

  return (
    <Switch>
      <Route path="/login">
        {isAuthenticated ? <Redirect to="/" /> : <LoginPage />}
      </Route>

      <Route path="/">
        <ProtectedLayout>
          <HomePage />
        </ProtectedLayout>
      </Route>

      <Route path="/files">
        <ProtectedLayout>
          <FileManager />
        </ProtectedLayout>
      </Route>

      <Route path="/terminal">
        <ProtectedLayout>
          <FileManager initialPanel="terminal" />
        </ProtectedLayout>
      </Route>

      <Route path="/dev">
        <ProtectedLayout>
          <DevPage />
        </ProtectedLayout>
      </Route>

      <Route path="/pm2/:name">
        <ProtectedLayout>
          <Pm2DetailPage />
        </ProtectedLayout>
      </Route>

      <Route path="/dns/zones/:zoneId">
        <ProtectedLayout><DnsPage /></ProtectedLayout>
      </Route>

      <Route path="/dns">
        <ProtectedLayout><DnsPage /></ProtectedLayout>
      </Route>

      <Route path="/connections">
        <ProtectedLayout><ConnectionsPage /></ProtectedLayout>
      </Route>

      <Route path="/github-control">
        <ProtectedLayout><GithubControlPage /></ProtectedLayout>
      </Route>

      <Route path="/deploy-script">
        <ProtectedLayout><DeployScriptPage /></ProtectedLayout>
      </Route>

      <Route path="/firewall">
        <ProtectedLayout><FirewallPage /></ProtectedLayout>
      </Route>

      <Route path="/ports">
        <ProtectedLayout><PortsPage /></ProtectedLayout>
      </Route>

      <Route path="/connections/:id/terminal">
        <ProtectedLayout><RemoteTerminalPage /></ProtectedLayout>
      </Route>

      <Route path="/connections/:id/files">
        <ProtectedLayout><RemoteFilesPage /></ProtectedLayout>
      </Route>

      <Route path="/settings">
        <ProtectedLayout>
          <SettingsPage />
        </ProtectedLayout>
      </Route>

      <Route path="/terms">
        <TermsPage />
      </Route>

      <Route>
        <ProtectedLayout>
          <NotFound />
        </ProtectedLayout>
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeSetter />
      <AuthProvider>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <AppRoutes />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
