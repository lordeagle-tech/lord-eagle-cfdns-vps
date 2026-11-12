import { Link, useRoute, useLocation } from "wouter";
import { useGetServer, getGetServerQueryKey } from "@workspace/api-client-react";
import { Terminal, Server, Folder, Activity, Plus, Home, HardDrive } from "lucide-react";

export default function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [isServerRoute, params] = useRoute("/servers/:id/*?");
  const serverId = isServerRoute && params?.id ? parseInt(params.id) : null;
  
  const { data: server } = useGetServer(serverId!, {
    query: { 
      enabled: !!serverId,
      queryKey: getGetServerQueryKey(serverId!)
    }
  });

  const navLinks = [
    { href: "/", label: "Dashboard", icon: Home, exact: true },
    { href: "/add-server", label: "Add Server", icon: Plus, exact: true },
  ];

  const serverLinks = serverId ? [
    { href: `/servers/${serverId}`, label: "Overview", icon: HardDrive, exact: true },
    { href: `/servers/${serverId}/files`, label: "Files", icon: Folder, exact: false },
    { href: `/servers/${serverId}/terminal`, label: "Terminal", icon: Terminal, exact: false },
    { href: `/servers/${serverId}/processes`, label: "Processes", icon: Activity, exact: false },
  ] : [];

  return (
    <div className="min-h-screen flex bg-background text-foreground selection:bg-primary/30">
      <div className="w-64 flex-shrink-0 border-r border-border bg-card flex flex-col">
        <div className="h-14 flex items-center px-4 border-b border-border bg-background">
          <Terminal className="w-5 h-5 mr-3 text-primary" />
          <span className="font-mono font-bold tracking-tight text-lg text-primary">VPS_MGR</span>
        </div>
        
        <div className="p-4 flex-1 flex flex-col gap-1 overflow-y-auto">
          <div className="text-xs font-mono text-muted-foreground mb-2 mt-2 uppercase tracking-wider">Global</div>
          {navLinks.map((link) => {
            const isActive = link.exact ? location === link.href : location.startsWith(link.href);
            const Icon = link.icon;
            return (
              <Link 
                key={link.href} 
                href={link.href} 
                className={`flex items-center gap-3 px-3 py-2 rounded-sm text-sm font-mono transition-colors ${
                  isActive ? "bg-primary/10 text-primary" : "hover:bg-accent hover:text-accent-foreground text-muted-foreground"
                }`}
                data-testid={`nav-${link.label.toLowerCase().replace(' ', '-')}`}
              >
                <Icon className="w-4 h-4" /> {link.label}
              </Link>
            );
          })}

          {serverId && (
            <>
              <div className="mt-8 mb-2 text-xs font-mono text-primary/70 uppercase tracking-wider truncate flex items-center gap-2">
                <Server className="w-3 h-3" />
                {server?.name || 'Loading...'}
              </div>
              {serverLinks.map((link) => {
                const isActive = link.exact ? location === link.href : location.startsWith(link.href);
                const Icon = link.icon;
                return (
                  <Link 
                    key={link.href} 
                    href={link.href} 
                    className={`flex items-center gap-3 px-3 py-2 rounded-sm text-sm font-mono transition-colors ${
                      isActive ? "bg-primary/10 text-primary" : "hover:bg-accent hover:text-accent-foreground text-muted-foreground"
                    }`}
                    data-testid={`nav-server-${link.label.toLowerCase()}`}
                  >
                    <Icon className="w-4 h-4" /> {link.label}
                  </Link>
                );
              })}
            </>
          )}
        </div>
      </div>
      <main className="flex-1 flex flex-col min-w-0">
        {children}
      </main>
    </div>
  )
}
