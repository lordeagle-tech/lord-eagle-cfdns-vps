import { useState, type FormEvent } from "react";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Check, Eye, KeyRound, Loader2, LockKeyhole, ShieldCheck, Terminal } from "lucide-react";

export default function LoginPage() {
  const { login } = useAuth();
  const [key, setKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanPhase, setScanPhase] = useState<"idle" | "scanning" | "granted">("idle");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!key.trim()) return;
    setLoading(true);
    setError(null);
    setScanPhase("scanning");
    const result = await login(key.trim(), { onVerified: () => setScanPhase("granted") });
    setLoading(false);
    if (!result.ok) { setScanPhase("idle"); setError(result.error ?? "Authentication failed"); }
  }

  return <div className="relative min-h-full overflow-y-auto flex items-center justify-center px-4" style={{ background: "#0b0b0c" }}>
    <div className="pointer-events-none fixed inset-0" style={{ background: "radial-gradient(ellipse 65% 55% at 50% -10%, rgba(255,90,31,.2), transparent 70%)" }} />
    <div className="loop-login-network loop-network-visual" aria-hidden="true">
      <svg className="loop-network-links" viewBox="0 0 1000 700" preserveAspectRatio="none">
        <path className="loop-network-route" d="M420 320 C340 240 205 145 70 105" />
        <path className="loop-network-route route-two" d="M420 320 C590 250 770 150 925 95" />
        <path className="loop-network-route route-three" d="M420 320 C270 390 155 525 65 620" />
        <path className="loop-network-route route-four" d="M420 320 C590 405 765 520 930 620" />
        <path className="loop-network-route route-five" d="M70 105 C260 55 540 55 925 95" />
        <path className="loop-network-route route-six" d="M65 620 C310 675 665 680 930 620" />
        <path className="loop-network-route route-seven" d="M925 95 C860 245 875 430 930 620" />
        <path className="loop-network-route route-eight" d="M70 105 C35 275 35 455 65 620" />
        <path className="loop-network-route route-nine" d="M420 320 C360 265 300 220 230 190" />
        <path className="loop-network-route route-ten" d="M420 320 C535 285 635 260 755 245" />
        <path className="loop-network-route route-eleven" d="M420 320 C365 390 305 455 245 505" />
        <path className="loop-network-route route-twelve" d="M420 320 C545 390 655 455 765 515" />
        <path className="loop-network-route route-thirteen" d="M230 190 C400 160 595 185 755 245" />
        <path className="loop-network-route route-fourteen" d="M245 505 C420 555 605 560 765 515" />
        <g className="loop-network-endpoints">
          <circle cx="420" cy="320" r="5" /><circle cx="70" cy="105" r="4" />
          <circle cx="925" cy="95" r="4" /><circle cx="65" cy="620" r="4" />
          <circle cx="930" cy="620" r="4" />
        </g>
        <g className="loop-network-junctions">
          <circle cx="230" cy="190" r="5" /><circle cx="755" cy="245" r="5" />
          <circle cx="245" cy="505" r="5" /><circle cx="765" cy="515" r="5" />
          <circle cx="585" cy="165" r="3.5" /><circle cx="500" cy="545" r="3.5" />
        </g>
        <g className="loop-network-signals">
          <circle r="5"><animateMotion dur="2.2s" repeatCount="indefinite" path="M420 320 C340 240 205 145 70 105" /></circle>
          <circle r="4"><animateMotion dur="2.2s" begin="-1.1s" repeatCount="indefinite" path="M420 320 C340 240 205 145 70 105" /></circle>
          <circle r="5"><animateMotion dur="2.5s" begin="-.7s" repeatCount="indefinite" path="M420 320 C590 250 770 150 925 95" /></circle>
          <circle r="4"><animateMotion dur="2.5s" begin="-1.9s" repeatCount="indefinite" path="M420 320 C590 250 770 150 925 95" /></circle>
          <circle r="4.5"><animateMotion dur="2.4s" begin="-1.2s" repeatCount="indefinite" path="M420 320 C270 390 155 525 65 620" /></circle>
          <circle r="4.5"><animateMotion dur="2.7s" begin="-.4s" repeatCount="indefinite" path="M420 320 C590 405 765 520 930 620" /></circle>
          <circle r="4"><animateMotion dur="2.8s" begin="-1s" repeatCount="indefinite" path="M70 105 C260 55 540 55 925 95" /></circle>
          <circle r="4"><animateMotion dur="3s" begin="-1.5s" repeatCount="indefinite" path="M65 620 C310 675 665 680 930 620" /></circle>
          <circle r="4"><animateMotion dur="2.8s" begin="-.9s" repeatCount="indefinite" path="M925 95 C860 245 875 430 930 620" /></circle>
          <circle r="4"><animateMotion dur="2.8s" begin="-1.8s" repeatCount="indefinite" path="M70 105 C35 275 35 455 65 620" /></circle>
          <circle r="4.5"><animateMotion dur="2.1s" begin="-.3s" repeatCount="indefinite" path="M420 320 C360 265 300 220 230 190" /></circle>
          <circle r="4.5"><animateMotion dur="2.3s" begin="-.8s" repeatCount="indefinite" path="M420 320 C535 285 635 260 755 245" /></circle>
          <circle r="4.5"><animateMotion dur="2.2s" begin="-1.1s" repeatCount="indefinite" path="M420 320 C365 390 305 455 245 505" /></circle>
          <circle r="4.5"><animateMotion dur="2.4s" begin="-.6s" repeatCount="indefinite" path="M420 320 C545 390 655 455 765 515" /></circle>
          <circle r="4"><animateMotion dur="2.7s" begin="-1.4s" repeatCount="indefinite" path="M230 190 C400 160 595 185 755 245" /></circle>
          <circle r="4"><animateMotion dur="2.8s" begin="-1.7s" repeatCount="indefinite" path="M245 505 C420 555 605 560 765 515" /></circle>
        </g>
      </svg>
      <div className="loop-network-grid" />
      <div className="loop-network-line loop-network-line-one" />
      <div className="loop-network-line loop-network-line-two" />
      <div className="loop-network-line loop-network-line-three" />
      <div className="loop-network-line loop-network-line-four" />
      <div className="loop-network-line loop-network-line-five" />
      <div className="loop-network-line loop-network-line-six" />
      <div className="loop-network-core">LE</div>
      <div className="loop-network-node loop-network-node-one"><span />AUTH / 01</div>
      <div className="loop-network-node loop-network-node-two"><span />DNS / 02</div>
      <div className="loop-network-node loop-network-node-three"><span />VPS / 03</div>
      <div className="loop-network-node loop-network-node-four"><span />API / 04</div>
      <div className="loop-network-node loop-network-node-five"><span />EDGE / 05</div>
    </div>
    <div className="relative z-10 w-full max-w-[360px]">
      <div className="text-center mb-9">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-5" style={{ background: "linear-gradient(135deg,#ff5a1f,#ffd1c2)", padding: 2 }}>
          <div className="w-full h-full rounded-2xl flex items-center justify-center" style={{ background: "#0b0b0c" }}><span className="text-sm font-black brand-gradient">LE</span></div>
        </div>
        <h1 className="text-2xl font-black tracking-tight"><span className="brand-gradient">CFDNS</span> <span className="text-foreground">MANAGER</span></h1>
        <p className="text-sm text-muted-foreground mt-2">Domains and servers, in one control plane. Built by Lord Eagle.</p>
      </div>
      <div className="loop-float-card rounded-2xl px-7 py-9 min-h-[300px] flex flex-col justify-center" style={{ background: "#111113", border: "1px solid rgba(255,90,31,.22)", boxShadow: "0 0 60px rgba(255,90,31,.12)" }}>
        {scanPhase !== "idle" && <div className={`loop-scan-overlay ${scanPhase === "granted" ? "is-granted" : ""}`} role="status" aria-live="polite">
          <div className="loop-scan-eye" aria-hidden="true">
            <div className="loop-scan-orbit loop-scan-orbit-one" />
            <div className="loop-scan-orbit loop-scan-orbit-two" />
            <div className="loop-scan-iris"><Eye className="h-7 w-7" /><LockKeyhole className="loop-scan-lock h-3.5 w-3.5" /></div>
          </div>
          <div className="loop-scan-label">{scanPhase === "granted" ? <><Check className="h-3.5 w-3.5" /> ACCESS GRANTED</> : <><Loader2 className="h-3.5 w-3.5 animate-spin" /> SCANNING CREDENTIAL</>}</div>
          <div className="loop-scan-meter"><span /></div>
        </div>}
        <div className="flex items-start gap-3 mb-5">
          <ShieldCheck className="w-5 h-5 mt-0.5 text-[#ff5a1f]" />
          <div><h2 className="font-semibold text-foreground">Use your access key</h2><p className="text-xs text-muted-foreground mt-1">Enter the key configured by your administrator.</p></div>
        </div>
        <form onSubmit={handleSubmit} className={`space-y-3 loop-login-form ${scanPhase !== "idle" ? "is-scanning" : ""}`}>
          <label className="text-xs font-semibold uppercase tracking-wider text-[#ffd1c2]">Access key</label>
          <div className="relative"><KeyRound className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input value={key} onChange={(e) => setKey(e.target.value)} type="password" autoFocus placeholder="Paste your access key" className="pl-9 font-mono" /></div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <Button type="submit" disabled={loading || !key.trim()} className="w-full" style={{ background: "linear-gradient(135deg,#ff5a1f,#ffd1c2)", color: "#0b0b0c", border: "none" }}>{loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Verify access key"}</Button>
        </form>
      </div>
      <p className="flex items-center justify-center gap-2 text-center text-xs text-muted-foreground mt-6"><Terminal className="w-3.5 h-3.5 text-[#ffd1c2]" /> Credentials stay server-side; provider tokens are never shown again.</p>
    </div>
  </div>;
}
