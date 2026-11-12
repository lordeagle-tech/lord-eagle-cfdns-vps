import { useParams } from "wouter";
import { useGetServerStats, getGetServerStatsQueryKey, useGetServer, getGetServerQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Cpu, HardDrive, MemoryStick, Activity, Clock, Info } from "lucide-react";
import { useMemo } from "react";

export default function ServerHome() {
  const { id } = useParams<{ id: string }>();
  const serverId = parseInt(id);

  const { data: server } = useGetServer(serverId, {
    query: { enabled: !!serverId, queryKey: getGetServerQueryKey(serverId) }
  });

  const { data: stats, isLoading, isError } = useGetServerStats(serverId, {
    query: { 
      enabled: !!serverId, 
      queryKey: getGetServerStatsQueryKey(serverId),
      refetchInterval: 10000 // auto refresh every 10s
    }
  });

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const mainDisk = useMemo(() => {
    if (!stats?.disk) return null;
    return stats.disk.find(d => d.mountedOn === '/') || stats.disk[0];
  }, [stats]);

  if (isLoading && !stats) {
    return (
      <div className="p-8 flex-1 overflow-y-auto">
        <div className="mb-8">
          <Skeleton className="h-10 w-64 mb-2" />
          <Skeleton className="h-4 w-96" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-8 flex-1 flex flex-col items-center justify-center text-center">
        <Activity className="w-12 h-12 text-destructive mb-4" />
        <h2 className="text-2xl font-mono font-bold text-foreground">Node Unreachable</h2>
        <p className="text-muted-foreground font-mono mt-2">Could not fetch telemetry for {server?.name}. Check connection.</p>
      </div>
    );
  }

  return (
    <div className="p-8 flex-1 overflow-y-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-mono font-bold text-foreground tracking-tight">Telemetry_{server?.name || id}</h1>
        <div className="text-muted-foreground font-mono text-sm mt-1 flex flex-wrap gap-4 items-center">
          <span className="flex items-center gap-1"><Info className="w-3 h-3"/> {stats?.os}</span>
          <span className="flex items-center gap-1"><Clock className="w-3 h-3"/> {stats?.uptime}</span>
          <span>Kernel: {stats?.kernel}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <Card className="bg-card/50 border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-mono text-muted-foreground">CPU Usage</CardTitle>
            <Cpu className="w-4 h-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-mono font-bold text-foreground mb-4" data-testid="stat-cpu-usage">
              {stats?.cpu.usage.toFixed(1)}%
            </div>
            <Progress value={stats?.cpu.usage} className="h-2 mb-2" />
            <div className="text-xs font-mono text-muted-foreground">
              {stats?.cpu.cores} Cores • {stats?.cpu.model}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card/50 border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-mono text-muted-foreground">Memory</CardTitle>
            <MemoryStick className="w-4 h-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-mono font-bold text-foreground mb-4" data-testid="stat-mem-usage">
              {stats?.memory.usagePercent.toFixed(1)}%
            </div>
            <Progress value={stats?.memory.usagePercent} className="h-2 mb-2" />
            <div className="text-xs font-mono text-muted-foreground flex justify-between">
              <span>{formatBytes(stats?.memory.used || 0)} used</span>
              <span>{formatBytes(stats?.memory.total || 0)} total</span>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card/50 border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-mono text-muted-foreground">Root Disk</CardTitle>
            <HardDrive className="w-4 h-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-mono font-bold text-foreground mb-4" data-testid="stat-disk-usage">
              {mainDisk?.usePercent || '0%'}
            </div>
            <Progress value={parseFloat(mainDisk?.usePercent || '0')} className="h-2 mb-2" />
            <div className="text-xs font-mono text-muted-foreground flex justify-between">
              <span>{mainDisk?.used || '0B'} used</span>
              <span>{mainDisk?.size || '0B'} total</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="bg-card/50 border-border/50">
          <CardHeader>
            <CardTitle className="text-sm font-mono text-muted-foreground">Load Average</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-8 items-end" data-testid="stat-load-avg">
              {stats?.loadAverage.map((load, i) => (
                <div key={i} className="flex flex-col items-center">
                  <span className="text-2xl font-mono font-bold text-foreground">{load.toFixed(2)}</span>
                  <span className="text-xs font-mono text-muted-foreground mt-1">{i === 0 ? '1m' : i === 1 ? '5m' : '15m'}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card/50 border-border/50">
          <CardHeader>
            <CardTitle className="text-sm font-mono text-muted-foreground">System Information</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 text-sm font-mono">
              <div>
                <div className="text-muted-foreground mb-1">Hostname</div>
                <div className="text-foreground" data-testid="stat-hostname">{stats?.hostname}</div>
              </div>
              <div>
                <div className="text-muted-foreground mb-1">Status</div>
                <div className="text-primary font-bold">{server?.status.toUpperCase()}</div>
              </div>
              <div className="col-span-2 mt-2">
                <div className="text-muted-foreground mb-1">All Mounts</div>
                <div className="space-y-1 mt-2">
                  {stats?.disk.map((d, i) => (
                    <div key={i} className="flex justify-between text-xs border-b border-border/50 pb-1 last:border-0">
                      <span className="text-muted-foreground w-16 truncate">{d.mountedOn}</span>
                      <span className="w-16 text-right">{d.usePercent}</span>
                      <span className="w-24 text-right">{d.used} / {d.size}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
