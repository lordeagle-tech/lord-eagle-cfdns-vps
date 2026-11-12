import { useParams } from "wouter";
import { useExecCommand, ExecResult } from "@workspace/api-client-react";
import { useState, useRef, useEffect } from "react";
import { Terminal as TerminalIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";

type HistoryEntry = {
  id: string;
  type: 'command' | 'output' | 'error';
  content: string;
  command?: string; // the command that caused this output
  exitCode?: number;
};

export default function ServerTerminal() {
  const { id } = useParams<{ id: string }>();
  const serverId = parseInt(id);
  const [command, setCommand] = useState("");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  const execMutation = useExecCommand({
    mutation: {
      onSuccess: (data) => {
        setHistory(prev => [
          ...prev, 
          { id: crypto.randomUUID(), type: 'output', content: data.stdout, command: data.command, exitCode: data.exitCode },
          ...(data.stderr ? [{ id: crypto.randomUUID(), type: 'error' as const, content: data.stderr, command: data.command, exitCode: data.exitCode }] : [])
        ]);
      },
      onError: (err) => {
        setHistory(prev => [
          ...prev,
          { id: crypto.randomUUID(), type: 'error', content: err.error || "Connection failed" }
        ]);
      }
    }
  });

  const handleExecute = (e: React.FormEvent) => {
    e.preventDefault();
    if (!command.trim()) return;

    setHistory(prev => [...prev, { id: crypto.randomUUID(), type: 'command', content: command }]);
    execMutation.mutate({ id: serverId, data: { command } });
    setCommand("");
  };

  useEffect(() => {
    // Scroll to bottom when history changes
    if (scrollRef.current) {
      const scrollContainer = scrollRef.current;
      scrollContainer.scrollTop = scrollContainer.scrollHeight;
    }
  }, [history]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-[#0A0A0C]">
      <div className="h-12 border-b border-border bg-card flex items-center px-4 flex-shrink-0">
        <TerminalIcon className="w-4 h-4 text-primary mr-2" />
        <span className="font-mono text-sm font-bold">tty1 - Remote Shell</span>
        {execMutation.isPending && <span className="ml-4 font-mono text-xs text-primary animate-pulse">executing...</span>}
      </div>

      <div className="flex-1 overflow-y-auto p-4 font-mono text-sm" ref={scrollRef} data-testid="terminal-output">
        <div className="text-primary/70 mb-4">
          Connected to node. Type a command to execute statelessly. <br/>
          (Note: `cd` commands won't persist across executions)
        </div>

        {history.map((entry) => (
          <div key={entry.id} className="mb-2 break-all">
            {entry.type === 'command' && (
              <div className="flex text-foreground">
                <span className="text-primary mr-2">root@node:~#</span>
                <span>{entry.content}</span>
              </div>
            )}
            {entry.type === 'output' && entry.content && (
              <div className="text-muted-foreground whitespace-pre-wrap pl-2 border-l-2 border-primary/30 mt-1 mb-2">
                {entry.content}
                {entry.exitCode !== undefined && entry.exitCode !== 0 && (
                  <div className="text-destructive text-xs mt-1">[Exit {entry.exitCode}]</div>
                )}
              </div>
            )}
            {entry.type === 'error' && entry.content && (
              <div className="text-destructive whitespace-pre-wrap pl-2 border-l-2 border-destructive/50 mt-1 mb-2">
                {entry.content}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="p-4 border-t border-border bg-card/50 flex-shrink-0">
        <form onSubmit={handleExecute} className="flex items-center">
          <span className="text-primary font-mono mr-2 font-bold text-sm">root@node:~#</span>
          <Input 
            className="flex-1 bg-transparent border-none outline-none ring-0 shadow-none focus-visible:ring-0 rounded-none font-mono text-sm px-0 h-auto" 
            autoFocus
            value={command}
            onChange={e => setCommand(e.target.value)}
            disabled={execMutation.isPending}
            placeholder="ls -la /var/log"
            data-testid="input-command"
          />
        </form>
      </div>
    </div>
  );
}
