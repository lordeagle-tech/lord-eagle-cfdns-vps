import { useParams } from "wouter";
import { useListProcesses, getListProcessesQueryKey, useKillProcess, KillProcessBodySignal } from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Activity, Skull, Search } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

export default function ServerProcesses() {
  const { id } = useParams<{ id: string }>();
  const serverId = parseInt(id);
  const [search, setSearch] = useState("");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading } = useListProcesses(serverId, {
    query: {
      enabled: !!serverId,
      queryKey: getListProcessesQueryKey(serverId),
      refetchInterval: 5000 // auto refresh
    }
  });

  const killMutation = useKillProcess({
    mutation: {
      onSuccess: () => {
        toast({ title: "Signal sent successfully" });
        queryClient.invalidateQueries({ queryKey: getListProcessesQueryKey(serverId) });
      },
      onError: (err) => {
        toast({ title: "Failed to kill process", description: err.error, variant: "destructive" });
      }
    }
  });

  const handleKill = (pid: number) => {
    if (confirm(`Send SIGKILL to PID ${pid}?`)) {
      killMutation.mutate({ id: serverId, pid, data: { signal: KillProcessBodySignal.SIGKILL } });
    }
  };

  const filteredProcesses = data?.processes.filter(p => 
    p.command.toLowerCase().includes(search.toLowerCase()) || 
    p.user.toLowerCase().includes(search.toLowerCase()) ||
    p.pid.toString().includes(search)
  ) || [];

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="p-6 border-b border-border bg-card/30 flex justify-between items-center flex-shrink-0">
        <div>
          <h1 className="text-2xl font-mono font-bold flex items-center gap-3">
            <Activity className="w-6 h-6 text-primary" />
            Process_Manager
          </h1>
          <div className="text-muted-foreground font-mono text-xs mt-1">
            Total tasks: {data?.count || 0}
          </div>
        </div>
        <div className="relative w-64">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input 
            placeholder="Filter processes..." 
            className="font-mono pl-8 h-9 bg-background"
            value={search}
            onChange={e => setSearch(e.target.value)}
            data-testid="input-search-processes"
          />
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6 bg-background">
        <div className="border border-border rounded-md bg-card/50 overflow-hidden">
          <Table>
            <TableHeader className="bg-muted/50 font-mono text-xs">
              <TableRow className="border-border">
                <TableHead className="w-[100px]">PID</TableHead>
                <TableHead className="w-[120px]">USER</TableHead>
                <TableHead className="w-[80px]">CPU%</TableHead>
                <TableHead className="w-[80px]">MEM%</TableHead>
                <TableHead className="w-[100px]">STAT</TableHead>
                <TableHead>COMMAND</TableHead>
                <TableHead className="text-right w-[80px]">ACT</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="font-mono text-sm">
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    Fetching process list...
                  </TableCell>
                </TableRow>
              ) : filteredProcesses.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    No matching processes found.
                  </TableCell>
                </TableRow>
              ) : (
                filteredProcesses.map(p => (
                  <TableRow key={p.pid} className="border-border hover:bg-muted/30">
                    <TableCell className="text-primary">{p.pid}</TableCell>
                    <TableCell>{p.user}</TableCell>
                    <TableCell className={p.cpu > 50 ? 'text-destructive' : p.cpu > 10 ? 'text-yellow-500' : ''}>{p.cpu.toFixed(1)}</TableCell>
                    <TableCell className={p.mem > 50 ? 'text-destructive' : p.mem > 20 ? 'text-yellow-500' : ''}>{p.mem.toFixed(1)}</TableCell>
                    <TableCell>{p.status}</TableCell>
                    <TableCell className="truncate max-w-[300px]" title={p.command}>{p.command}</TableCell>
                    <TableCell className="text-right">
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-6 w-6 text-muted-foreground hover:text-destructive"
                        onClick={() => handleKill(p.pid)}
                        disabled={killMutation.isPending}
                        data-testid={`btn-kill-${p.pid}`}
                      >
                        <Skull className="w-3 h-3" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
