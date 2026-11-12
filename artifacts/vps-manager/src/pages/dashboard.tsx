import { useListServers, getListServersQueryKey, useDeleteServer, useTestServerConnection } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Server, Activity, Terminal, Folder, Trash2, Power, AlertCircle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";

export default function Dashboard() {
  const { data: servers, isLoading } = useListServers({
    query: { queryKey: getListServersQueryKey() }
  });
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const deleteMutation = useDeleteServer({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListServersQueryKey() });
        toast({ title: "Server removed", variant: "default" });
      },
      onError: () => {
        toast({ title: "Failed to remove server", variant: "destructive" });
      }
    }
  });

  const testConnectionMutation = useTestServerConnection({
    mutation: {
      onSuccess: (data) => {
        queryClient.invalidateQueries({ queryKey: getListServersQueryKey() });
        if (data.success) {
          toast({ title: "Connection successful", description: data.message });
        } else {
          toast({ title: "Connection failed", description: data.message, variant: "destructive" });
        }
      },
      onError: () => {
        toast({ title: "Connection test error", variant: "destructive" });
      }
    }
  });

  const totalServers = servers?.length || 0;
  const connectedServers = servers?.filter(s => s.status === 'connected').length || 0;
  const errorServers = servers?.filter(s => s.status === 'error').length || 0;

  return (
    <div className="flex-1 overflow-y-auto p-8">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-mono font-bold text-foreground tracking-tight">System_Dashboard</h1>
          <p className="text-muted-foreground font-mono text-sm mt-1">Overview of all registered virtual private servers</p>
        </div>
        <Button asChild className="font-mono" data-testid="button-add-server">
          <Link href="/add-server">
            <Server className="w-4 h-4 mr-2" /> Add Server
          </Link>
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <Card className="bg-card/50 border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-mono text-muted-foreground">Total Systems</CardTitle>
            <Server className="w-4 h-4 text-primary/60" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-mono font-bold" data-testid="stat-total-servers">
              {isLoading ? <Skeleton className="h-8 w-16" /> : totalServers}
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card/50 border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-mono text-muted-foreground">Connected</CardTitle>
            <CheckCircle2 className="w-4 h-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-mono font-bold text-primary" data-testid="stat-connected-servers">
              {isLoading ? <Skeleton className="h-8 w-16" /> : connectedServers}
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card/50 border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-mono text-muted-foreground">Errors</CardTitle>
            <AlertCircle className="w-4 h-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-mono font-bold text-destructive" data-testid="stat-error-servers">
              {isLoading ? <Skeleton className="h-8 w-16" /> : errorServers}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <h2 className="text-xl font-mono font-bold mb-4">Node_List</h2>
        
        {isLoading && (
          <div className="space-y-4">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        )}

        {!isLoading && servers?.length === 0 && (
          <div className="text-center py-16 border border-dashed border-border rounded-lg bg-card/20">
            <Server className="w-12 h-12 mx-auto text-muted-foreground/50 mb-4" />
            <h3 className="text-lg font-mono mb-2">No servers configured</h3>
            <p className="text-muted-foreground font-mono text-sm mb-6">Add your first Linux VPS to start managing it.</p>
            <Button asChild variant="outline" className="font-mono">
              <Link href="/add-server">Register Node</Link>
            </Button>
          </div>
        )}

        {servers?.map((server) => (
          <Card key={server.id} className="bg-card border-border hover:border-primary/50 transition-colors group">
            <CardContent className="p-0 flex items-center">
              <div className="flex-1 p-5 grid grid-cols-12 gap-4 items-center">
                <div className="col-span-3">
                  <Link href={`/servers/${server.id}`} className="block hover:underline" data-testid={`link-server-${server.id}`}>
                    <div className="font-mono font-bold text-lg">{server.name}</div>
                    <div className="font-mono text-xs text-muted-foreground mt-1">{server.username}@{server.host}:{server.port}</div>
                  </Link>
                </div>
                
                <div className="col-span-2">
                  <Badge 
                    variant={server.status === 'connected' ? 'default' : server.status === 'error' ? 'destructive' : 'secondary'}
                    className="font-mono uppercase text-[10px]"
                    data-testid={`badge-status-${server.id}`}
                  >
                    {server.status}
                  </Badge>
                </div>

                <div className="col-span-3 text-xs font-mono text-muted-foreground">
                  Auth: {server.authType}
                  {server.notes && <div className="truncate mt-1 text-muted-foreground/70" title={server.notes}>{server.notes}</div>}
                </div>

                <div className="col-span-4 flex items-center justify-end gap-2">
                  <Button variant="ghost" size="icon" asChild className="text-muted-foreground hover:text-primary">
                    <Link href={`/servers/${server.id}`} data-testid={`btn-stats-${server.id}`} title="Stats">
                      <Activity className="w-4 h-4" />
                    </Link>
                  </Button>
                  <Button variant="ghost" size="icon" asChild className="text-muted-foreground hover:text-primary">
                    <Link href={`/servers/${server.id}/files`} data-testid={`btn-files-${server.id}`} title="Files">
                      <Folder className="w-4 h-4" />
                    </Link>
                  </Button>
                  <Button variant="ghost" size="icon" asChild className="text-muted-foreground hover:text-primary">
                    <Link href={`/servers/${server.id}/terminal`} data-testid={`btn-term-${server.id}`} title="Terminal">
                      <Terminal className="w-4 h-4" />
                    </Link>
                  </Button>
                  
                  <div className="w-px h-6 bg-border mx-1" />
                  
                  <Button 
                    variant="ghost" 
                    size="icon"
                    onClick={() => testConnectionMutation.mutate({ id: server.id })}
                    disabled={testConnectionMutation.isPending}
                    title="Test Connection"
                    className="text-muted-foreground hover:text-primary"
                    data-testid={`btn-connect-${server.id}`}
                  >
                    <Power className={`w-4 h-4 ${testConnectionMutation.isPending ? 'animate-pulse text-primary' : ''}`} />
                  </Button>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    onClick={() => {
                      if(confirm(`Are you sure you want to remove ${server.name}?`)) {
                        deleteMutation.mutate({ id: server.id });
                      }
                    }}
                    className="text-muted-foreground hover:text-destructive"
                    title="Remove Server"
                    data-testid={`btn-delete-${server.id}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
