import { Link } from "wouter";
import { Github, Globe2, Send, Instagram, HeadphonesIcon } from "lucide-react";

const LINKS: { href: string; label: string; icon: typeof Github }[] = [
  { href: "https://github.com/lordeagle-tech", label: "GitHub", icon: Github },
  { href: "https://website.lordeagle.tech", label: "Website", icon: Globe2 },
  { href: "https://wa.me/254114879633", label: "WhatsApp", icon: Send },
  { href: "https://t.me/Eagle1591", label: "Telegram", icon: Send },
  { href: "https://instagram.com/eagle.254", label: "Instagram", icon: Instagram },
  { href: "mailto:company@lordeagle.co.ke", label: "Company Support", icon: HeadphonesIcon },
];

export function Footer() {
  return (
    <footer
      className="flex-shrink-0 border-t py-3 px-4"
      style={{
        borderColor: "rgba(255,90,31,.18)",
        background: "rgba(8,9,13,.6)",
        backdropFilter: "blur(8px)",
      }}
    >
      <div className="max-w-screen-xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground text-center sm:text-left">
          © 2026{" "}
          <span className="font-semibold text-foreground/70">CFDNS MANAGER</span>{" "}
          by{" "}
          <span className="brand-gradient font-semibold">LORD EAGLE</span>
          {" · "}
          <a href="https://website.lordeagle.tech" target="_blank" rel="noopener noreferrer"
            className="hover:text-foreground transition-colors">
            website.lordeagle.tech
          </a>
          {" · "}
          <Link href="/terms" className="hover:text-foreground transition-colors">
            Terms &amp; Privacy
          </Link>
        </p>

        <div className="flex items-center gap-1">
          {LINKS.map(({ href, label, icon: Icon }) => (
            <a
              key={href}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              title={label}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground transition-colors"
            >
              <Icon className="w-3.5 h-3.5" />
            </a>
          ))}
        </div>
      </div>
    </footer>
  );
}
