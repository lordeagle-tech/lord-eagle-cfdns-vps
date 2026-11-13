import { useMemo, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  Database,
  ExternalLink,
  KeyRound,
  Search,
  ShieldCheck,
} from "lucide-react";
import { Link } from "wouter";
import { Input } from "@/components/ui/input";
import { DOC_SECTIONS } from "@/data/docs-content";

const panel =
  "rounded-2xl border border-cyan-300/20 bg-[#10181c]/90 shadow-[0_12px_34px_rgba(0,0,0,.24)]";

export default function DocsPage() {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();

  const visibleSections = useMemo(() => {
    if (!normalizedQuery) return DOC_SECTIONS;
    return DOC_SECTIONS.filter((section) => {
      const searchable = [
        section.title,
        section.summary,
        ...section.groups.flatMap((group) => [group.title, ...group.items]),
      ]
        .join(" ")
        .toLowerCase();
      return searchable.includes(normalizedQuery);
    });
  }, [normalizedQuery]);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="mx-auto max-w-screen-2xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        <header className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-4xl">
            <div className="mb-3 flex items-center gap-2 text-xs uppercase tracking-[.18em] text-amber-200">
              <BookOpen className="h-4 w-4" /> Operations handbook
            </div>
            <h1 className="text-3xl font-black tracking-tight sm:text-4xl">
              CFDNS Manager <span className="text-cyan-200">Docs</span>
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground sm:text-base">
              A practical guide to the dashboard, Cloudflare DNS, VPS
              connections, terminals, GitHub tools, security, installation, and
              recovery. Read the limits before changing live infrastructure.
            </p>
          </div>
          <div className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto">
            <label className="relative w-full sm:w-72">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-cyan-100/60" />
              <Input
                aria-label="Search documentation"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search this guide…"
                className="h-11 border-cyan-200/20 bg-[#0d1215] pl-10"
              />
            </label>
            <a
              href="https://github.com/lordeagle-tech/lord-eagle-cfdns-vps#readme"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-amber-200/25 px-4 text-sm font-semibold text-amber-100 transition-colors hover:bg-amber-300/10"
            >
              <ExternalLink className="h-4 w-4" /> Full README
            </a>
          </div>
        </header>

        <section
          className={`${panel} grid gap-4 p-4 sm:grid-cols-[1.3fr_1fr] sm:p-5`}
        >
          <div className="flex gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-amber-200/20 bg-amber-300/10 text-amber-100">
              <KeyRound className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-bold">Before you begin</h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                CFDNS Manager can make live changes to DNS, remote files,
                repositories, firewalls, and servers. Use it only for
                infrastructure you own or are authorized to administer, and
                verify the target before every change.
              </p>
            </div>
          </div>
          <div className="flex flex-col justify-center gap-2 border-t border-cyan-200/10 pt-4 text-xs text-muted-foreground sm:border-l sm:border-t-0 sm:pl-5 sm:pt-0">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-cyan-200" />
              Use your own HTTPS installation for real credentials.
            </div>
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-200" />
              Shared Preview intentionally disables several live operations.
            </div>
            <div className="flex items-center gap-2">
              <Database className="h-4 w-4 text-cyan-200" />
              Back up the database and encryption key together.
            </div>
          </div>
        </section>

        <div className="grid gap-5 lg:grid-cols-[230px_minmax(0,1fr)] xl:gap-7">
          <aside className={`${panel} h-fit p-3 lg:sticky lg:top-4`}>
            <div className="px-3 pb-2 pt-1 text-[10px] font-bold uppercase tracking-[.18em] text-muted-foreground">
              Contents
            </div>
            <nav
              aria-label="Documentation sections"
              className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-x-visible"
            >
              {visibleSections.map((section) => {
                const Icon = section.icon;
                return (
                  <a
                    key={section.id}
                    href={`#${section.id}`}
                    className="flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-cyan-300/10 hover:text-cyan-100 lg:w-full"
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0" />
                    <span>{section.title}</span>
                  </a>
                );
              })}
            </nav>
            <div className="mt-3 hidden border-t border-cyan-200/10 px-3 pt-3 text-[11px] leading-5 text-muted-foreground lg:block">
              {visibleSections.length} of {DOC_SECTIONS.length} sections shown
            </div>
          </aside>

          <div className="min-w-0 space-y-5">
            {visibleSections.length === 0 ? (
              <div className={`${panel} p-8 text-center`}>
                <Search className="mx-auto mb-3 h-7 w-7 text-cyan-200/70" />
                <h2 className="font-bold">No matching guidance</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Try a different word, or clear your search.
                </p>
                <button
                  onClick={() => setQuery("")}
                  className="mt-4 text-sm font-semibold text-amber-200 underline underline-offset-4"
                >
                  Clear search
                </button>
              </div>
            ) : (
              visibleSections.map((section, index) => {
                const Icon = section.icon;
                return (
                  <section
                    key={section.id}
                    id={section.id}
                    className={`${panel} scroll-mt-5 overflow-hidden`}
                  >
                    <div className="border-b border-cyan-200/10 bg-gradient-to-r from-cyan-300/[.07] via-transparent to-amber-300/[.035] px-5 py-5 sm:px-6">
                      <div className="flex items-start gap-3">
                        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-cyan-200/20 bg-cyan-300/10 text-cyan-100">
                          <Icon className="h-5 w-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="mb-1 text-[10px] font-bold uppercase tracking-[.16em] text-cyan-100/60">
                            Guide {String(index + 1).padStart(2, "0")}
                          </div>
                          <h2 className="text-xl font-black tracking-tight sm:text-2xl">
                            {section.title}
                          </h2>
                          <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
                            {section.summary}
                          </p>
                        </div>
                      </div>
                      {section.links && (
                        <div className="mt-4 flex flex-wrap gap-2 pl-0 sm:pl-[3.25rem]">
                          {section.links.map((link) =>
                            link.href.startsWith("/") ? (
                              <Link
                                key={link.href}
                                href={link.href}
                                className="inline-flex items-center gap-1.5 rounded-full border border-amber-200/20 bg-amber-300/[.06] px-3 py-1.5 text-xs font-semibold text-amber-100 transition-colors hover:bg-amber-300/15"
                              >
                                {link.label}
                                <ExternalLink className="h-3 w-3" />
                              </Link>
                            ) : (
                              <a
                                key={link.href}
                                href={link.href}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 rounded-full border border-amber-200/20 bg-amber-300/[.06] px-3 py-1.5 text-xs font-semibold text-amber-100 transition-colors hover:bg-amber-300/15"
                              >
                                {link.label}
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            ),
                          )}
                        </div>
                      )}
                    </div>
                    <div className="grid gap-0 divide-y divide-cyan-200/[.08] xl:grid-cols-2 xl:divide-x xl:divide-y-0">
                      {section.groups.map((group) => (
                        <div
                          key={group.title}
                          className={`p-5 sm:p-6 ${group.kind === "warning" ? "bg-amber-300/[.025]" : ""}`}
                        >
                          <h3
                            className={`mb-3 flex items-center gap-2 text-sm font-bold ${group.kind === "warning" ? "text-amber-100" : "text-foreground"}`}
                          >
                            {group.kind === "warning" ? (
                              <AlertTriangle className="h-4 w-4 text-amber-200" />
                            ) : (
                              <span className="h-1.5 w-1.5 rounded-full bg-cyan-200 shadow-[0_0_10px_rgba(103,232,249,.55)]" />
                            )}
                            {group.title}
                          </h3>
                          {group.kind === "steps" ? (
                            <ol className="space-y-3">
                              {group.items.map((item, itemIndex) => (
                                <li
                                  key={item}
                                  className="flex gap-3 text-sm leading-6 text-muted-foreground"
                                >
                                  <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border border-cyan-200/20 bg-cyan-300/[.08] text-[10px] font-bold text-cyan-100">
                                    {itemIndex + 1}
                                  </span>
                                  <span>{item}</span>
                                </li>
                              ))}
                            </ol>
                          ) : (
                            <ul className="space-y-3">
                              {group.items.map((item) => (
                                <li
                                  key={item}
                                  className="flex gap-3 text-sm leading-6 text-muted-foreground"
                                >
                                  <span
                                    className={`mt-[.65rem] h-1.5 w-1.5 shrink-0 rounded-full ${group.kind === "warning" ? "bg-amber-200/80" : "bg-cyan-200/70"}`}
                                  />
                                  <span>{item}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      ))}
                    </div>
                  </section>
                );
              })
            )}

            <footer
              className={`${panel} flex flex-col gap-3 p-5 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between`}
            >
              <div>
                <p className="font-semibold text-foreground">
                  Need more implementation detail?
                </p>
                <p className="mt-1">
                  The repository README includes installation commands,
                  environment setup, and recovery procedures.
                </p>
              </div>
              <a
                href="https://github.com/lordeagle-tech/lord-eagle-cfdns-vps#readme"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex shrink-0 items-center gap-2 font-semibold text-amber-100 hover:text-amber-200"
              >
                Open project README <ExternalLink className="h-4 w-4" />
              </a>
            </footer>
          </div>
        </div>
      </div>
    </div>
  );
}
