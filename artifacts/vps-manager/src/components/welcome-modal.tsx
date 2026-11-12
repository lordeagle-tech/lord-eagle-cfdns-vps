import { Link } from "wouter";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Coffee, Github, Send, HeartHandshake, ExternalLink } from "lucide-react";

export function WelcomeModal() {
  const { isAuthenticated, welcomeShown, dismissWelcome } = useAuth();

  const open = isAuthenticated && !welcomeShown;

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent
        className="max-w-lg p-0 overflow-hidden"
        style={{ background: "#111113", border: "1px solid rgba(255,90,31,.28)" }}
        onInteractOutside={(e) => e.preventDefault()}
      >
        {/* Header gradient bar */}
        <div className="h-1 w-full brand-gradient-bg" />

        <div className="p-6">
          <DialogHeader className="mb-5">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{ background: "linear-gradient(135deg,#ff5a1f,#ffd1c2)" }}>
                <span className="text-sm font-black text-[#0b0b0c]">LE</span>
              </div>
              <div>
                <DialogTitle className="text-lg font-bold">
                  Welcome to <span className="brand-gradient">CFDNS MANAGER</span>
                </DialogTitle>
                <p className="text-xs text-muted-foreground mt-0.5">Built by Lord Eagle</p>
              </div>
            </div>
          </DialogHeader>

          {/* Summary blurb */}
          <div
            className="rounded-xl p-4 mb-5 space-y-2 text-sm text-muted-foreground leading-relaxed"
            style={{ background: "#0b0b0c", border: "1px solid rgba(255,90,31,.15)" }}
          >
            <p>
              By continuing you confirm that you are using this software
              <strong className="text-foreground"> on systems you own or are authorised to manage</strong>,
              and that you have read and agree to the Terms of Service and Privacy Policy.
            </p>
            <p className="text-xs">
              CFDNS MANAGER operates entirely on your own infrastructure.
              No telemetry or usage data is ever collected or transmitted.
            </p>
            <Link
              href="/terms"
              onClick={dismissWelcome}
              className="inline-flex items-center gap-1 text-xs font-medium hover:text-foreground transition-colors"
              style={{ color: "#ffb89f" }}
            >
              Read full Terms, Privacy &amp; Disclaimer <ExternalLink className="w-3 h-3" />
            </Link>
          </div>

          <div className="flex items-center gap-2 mb-4 text-xs flex-wrap">
            <a href="https://github.com/lordeagle-tech" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground transition-colors" style={{ color: "#ffb89f" }}>GitHub</a>
            <span className="text-muted-foreground/50">·</span>
            <a href="https://website.lordeagle.tech" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground transition-colors" style={{ color: "#ffb89f" }}>Zynex Tech</a>
            <span className="text-muted-foreground/50">·</span>
            <a href="https://wa.me/254114879633" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground transition-colors" style={{ color: "#ffb89f" }}>WhatsApp</a>
            <span className="text-muted-foreground/50">·</span>
            <a href="https://t.me/Eagle1591" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground transition-colors" style={{ color: "#ffb89f" }}>Telegram</a>
            <span className="text-muted-foreground/50">·</span>
            <a href="mailto:company@lordeagle.co.ke" className="underline hover:text-foreground transition-colors" style={{ color: "#ffb89f" }}>Company Support</a>
          </div>

          <Button
            onClick={dismissWelcome}
            className="w-full font-semibold h-10"
            style={{ background: "linear-gradient(135deg,#ff5a1f,#ffd1c2)", color: "#0b0b0c", border: "none" }}
          >
            <HeartHandshake className="w-4 h-4 mr-2" />
            I Agree — Let's Go
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
