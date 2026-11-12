import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  Check,
  Copy,
  ExternalLink,
  Github,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldCheck,
  ShieldX,
} from "lucide-react";

interface PublicKeyInfo {
  type: string;
  publicKey: string;
  fingerprint: string;
}

interface SshStatus {
  enabled: boolean;
  configured: boolean;
  keys: PublicKeyInfo[];
  connected: boolean;
  tested: boolean;
  authUser: string | null;
  sshTestOutput: string;
  repo: string | null;
  repoAccessible: boolean | null;
  repoTestOutput: string | null;
}

const DEFAULT_REPOSITORY = "lordeagle-tech/lord-eagle-cfdns-vps";

function validRepository(value: string): boolean {
  const parts = value.trim().split("/");
  return parts.length === 2 && parts.every((part) => /^[A-Za-z0-9_.-]{1,100}$/.test(part) && part !== "." && part !== "..");
}

export function GithubSshSetup() {
  const { toast } = useToast();
  const [status, setStatus] = useState<SshStatus | null>(null);
  const [repository, setRepository] = useState(DEFAULT_REPOSITORY);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [testing, setTesting] = useState(false);
  const [copied, setCopied] = useState(false);

  async function refreshStatus() {
    setLoading(true);
    try {
      const response = await fetch("/api/github/ssh-key", { credentials: "include" });
      const body = await response.json() as SshStatus & { error?: string };
      if (!response.ok) throw new Error(body.error || "Could not read GitHub SSH setup status.");
      setStatus(body);
    } catch (error) {
      toast({ title: "Could not load GitHub SSH status", description: error instanceof Error ? error.message : "Request failed", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refreshStatus();
  }, []);

  async function generateKey() {
    setGenerating(true);
    try {
      const response = await fetch("/api/github/ssh-key/generate", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const body = await response.json() as SshStatus & { error?: string };
      if (!response.ok) throw new Error(body.error || "The VPS could not generate a key.");
      setStatus(body);
      toast({ title: "GitHub key ready", description: "The private key stays on this VPS. Copy the public key below." });
    } catch (error) {
      toast({ title: "Key generation failed", description: error instanceof Error ? error.message : "Request failed", variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  }

  async function testConnection() {
    setTesting(true);
    try {
      const response = await fetch("/api/github/ssh-key/test", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo: repository.trim() }),
      });
      const body = await response.json() as Partial<SshStatus> & { error?: string };
      if (!response.ok) throw new Error(body.error || "The GitHub connection test failed.");
      setStatus((previous) => ({
        enabled: previous?.enabled ?? true,
        configured: previous?.configured ?? true,
        keys: previous?.keys ?? [],
        connected: body.connected ?? false,
        tested: body.tested ?? true,
        authUser: body.authUser ?? null,
        sshTestOutput: body.sshTestOutput ?? "",
        repo: body.repo ?? repository.trim(),
        repoAccessible: body.repoAccessible ?? null,
        repoTestOutput: body.repoTestOutput ?? null,
      }));
      if (body.connected && body.repoAccessible) {
        toast({ title: "GitHub connection verified", description: `This VPS can read ${repository.trim()}.` });
      } else if (body.connected) {
        toast({ title: "SSH authenticated; repository access is missing", description: "Check that the public key was added to this repository's Deploy keys.", variant: "destructive" });
      } else {
        toast({ title: "GitHub did not accept the key", description: "Add the public key in GitHub, then test again.", variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Connection test failed", description: error instanceof Error ? error.message : "Request failed", variant: "destructive" });
    } finally {
      setTesting(false);
    }
  }

  async function copyPublicKey(value: string) {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = value;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      const copiedToClipboard = document.execCommand("copy");
      document.body.removeChild(textarea);
      if (!copiedToClipboard) {
        toast({ title: "Copy failed", description: "Select and copy the public key manually.", variant: "destructive" });
        return;
      }
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
    toast({ title: "Public key copied" });
  }

  const key = status?.keys[0];
  const repoValid = validRepository(repository.trim());
  const deployKeyUrl = repoValid
    ? `https://github.com/${repository.trim().split("/").map(encodeURIComponent).join("/")}/settings/keys`
    : null;
  const repoVerified = Boolean(status?.connected && status.repoAccessible);
  const authOnly = Boolean(status?.connected && status.repoAccessible === false);

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-3 mb-2">
        <div className="h-px flex-1" style={{ background: "rgba(255,90,31,.2)" }} />
        <span className="text-xs font-bold uppercase tracking-widest" style={{ color: "#ffd1c2" }}>VPS → GitHub Connection</span>
        <div className="h-px flex-1" style={{ background: "rgba(255,90,31,.2)" }} />
      </div>

      <div className="rounded-2xl p-5 sm:p-6 space-y-5" style={{ background: "#111113", border: "1px solid rgba(255,90,31,.18)" }}>
        {loading ? (
          <div className="space-y-3 animate-pulse">
            <div className="h-5 w-48 rounded bg-white/10" />
            <div className="h-20 rounded-xl bg-white/5" />
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: repoVerified ? "rgba(255,255,255,.12)" : "rgba(255,107,107,.1)", border: `1px solid ${repoVerified ? "rgba(255,255,255,.25)" : "rgba(255,107,107,.25)"}` }}>
                  {repoVerified
                    ? <ShieldCheck className="w-5 h-5" style={{ color: "#ffd1c2" }} />
                    : <ShieldX className="w-5 h-5" style={{ color: authOnly ? "#ffb15c" : "#ff6b6b" }} />}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-foreground">
                    {repoVerified ? "Repository access verified" : authOnly ? "SSH works; repository permission is missing" : status?.tested ? "GitHub did not accept the key" : key ? "Public key ready to add" : status?.enabled ? "GitHub key setup needed" : "Available after VPS installation"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {repoVerified
                      ? `This VPS can read ${status?.repo ?? repository}.`
                      : authOnly
                        ? `The key authenticated, but it cannot read ${status?.repo ?? repository}.`
                        : key
                          ? "Add the public key to the repository, then test access here."
                          : status?.enabled
                            ? "The installer creates a dedicated key on this VPS; generate one here only if it is missing."
                            : "The shared preview does not generate or access VPS private keys."}
                  </p>
                </div>
              </div>
              <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs border-border/50 flex-shrink-0"
                onClick={() => void refreshStatus()} disabled={loading || testing || generating} aria-label="Refresh GitHub key status">
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
              </Button>
            </div>

            {!status?.enabled && (
              <div className="rounded-xl p-3 text-xs leading-relaxed" style={{ background: "rgba(255,177,92,.08)", border: "1px solid rgba(255,177,92,.2)", color: "#ffd1c2" }}>
                GitHub SSH setup is enabled only on a self-hosted production VPS. This prevents a shared preview from generating or using host credentials.
              </div>
            )}

            {!key && status?.enabled && (
              <div className="rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3" style={{ background: "#0b0b0c", border: "1px solid rgba(255,90,31,.14)" }}>
                <div>
                  <p className="text-sm font-semibold text-foreground">No dedicated key found on this VPS</p>
                  <p className="text-xs text-muted-foreground mt-1">Generate an Ed25519 key locally. Its private half never leaves the VPS.</p>
                </div>
                <Button onClick={() => void generateKey()} disabled={generating} className="gap-2 flex-shrink-0"
                  style={{ background: "linear-gradient(135deg,#ff5a1f,#ffd1c2)", color: "#0b0b0c", border: "none" }}>
                  {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
                  {generating ? "Generating…" : "Generate key on VPS"}
                </Button>
              </div>
            )}

            {key && (
              <>
                <div className="rounded-xl p-4 space-y-3" style={{ background: "#0b0b0c", border: "1px solid rgba(255,90,31,.15)" }}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <KeyRound className="w-4 h-4 flex-shrink-0" style={{ color: "#ff5a1f" }} />
                      <span className="text-sm font-bold text-foreground">Dedicated VPS GitHub key</span>
                    </div>
                    <span className="text-xs font-mono text-muted-foreground/70">{key.fingerprint}</span>
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs text-muted-foreground/60 uppercase tracking-wider font-semibold">Public key only</span>
                      <button onClick={() => void copyPublicKey(key.publicKey)} className="flex items-center gap-1 text-xs transition-colors"
                        style={{ color: copied ? "#ffd1c2" : "var(--muted-foreground)" }}>
                        {copied ? <><Check className="w-3 h-3" /> Copied</> : <><Copy className="w-3 h-3" /> Copy key</>}
                      </button>
                    </div>
                    <div className="rounded-lg p-3 overflow-x-auto" style={{ background: "rgba(255,90,31,.05)", border: "1px solid rgba(255,90,31,.1)" }}>
                      <code className="text-xs font-mono break-all leading-relaxed text-foreground/70">{key.publicKey}</code>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground/70">This setup API returns only the public half; the private key stays on the VPS. The administrator terminal runs as the same service account, so grant panel admin access only to trusted users.</p>
                </div>

                <div className="space-y-3">
                  <label className="block text-xs font-semibold uppercase tracking-widest text-muted-foreground/70" htmlFor="github-deploy-repo">GitHub repository</label>
                  <Input id="github-deploy-repo" value={repository} onChange={(event) => setRepository(event.target.value)} placeholder="owner/repository" autoComplete="off" spellCheck={false} className="font-mono" />
                  <div className="rounded-xl p-4 space-y-3" style={{ background: "rgba(255,90,31,.05)", border: "1px solid rgba(255,90,31,.14)" }}>
                    <p className="text-xs font-semibold text-foreground">Add the key, then come back and test:</p>
                    <ol className="list-decimal list-inside space-y-1.5 text-xs text-muted-foreground">
                      <li>Copy the public key above.</li>
                      <li>Open this repository's GitHub Deploy keys settings.</li>
                      <li>Choose <strong className="text-foreground">Add deploy key</strong>, paste it, and save.</li>
                      <li>Return here and test repository access.</li>
                    </ol>
                    <p className="text-xs text-muted-foreground">Leave <strong className="text-foreground">Allow write access</strong> off unless this VPS needs to push changes.</p>
                    {deployKeyUrl ? (
                      <a href={deployKeyUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-sm font-semibold hover:opacity-80" style={{ color: "#ff8a5d" }}>
                        <Github className="w-4 h-4" /> Open GitHub Deploy keys <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    ) : (
                      <p className="text-xs text-red-300">Enter a valid repository in `owner/repository` format to open its settings.</p>
                    )}
                  </div>
                  <Button onClick={() => void testConnection()} disabled={!status?.enabled || testing || !key || !repoValid} className="w-full sm:w-auto gap-2"
                    style={{ background: "linear-gradient(135deg,#ff5a1f,#ffd1c2)", color: "#0b0b0c", border: "none" }}>
                    {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                    {testing ? "Testing GitHub and repository…" : status?.tested ? "Test again" : "Test GitHub connection"}
                  </Button>
                </div>
              </>
            )}

            {status?.tested && (status.sshTestOutput || status.repoTestOutput) && (
              <details className="group">
                <summary className="text-xs text-muted-foreground/50 cursor-pointer hover:text-muted-foreground transition-colors select-none">Connection test details</summary>
                <div className="mt-2 rounded-lg p-3 space-y-2" style={{ background: "#0b0b0c", border: "1px solid rgba(255,90,31,.1)" }}>
                  {status.sshTestOutput && <p className="text-xs font-mono text-foreground/60 break-words">{status.sshTestOutput}</p>}
                  {status.repoTestOutput && <p className="text-xs font-mono text-foreground/60 break-words">{status.repoTestOutput}</p>}
                </div>
              </details>
            )}
          </>
        )}
      </div>
    </section>
  );
}
