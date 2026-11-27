"use client";

import { BarChart3, Bookmark, Briefcase, Gauge, Kanban, LogOut, Plug, Settings, ShieldCheck, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ThemeToggle } from "./ThemeToggle";
import { IntegrationsIcons, IntegrationsMini } from "./IntegrationsPanel";
import { Logo } from "./Logo";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

const NAV_GROUPS: Array<{ title: string; items: NavItem[] }> = [
  {
    title: "Workspace",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: Gauge },
      { href: "/jobs", label: "Jobs", icon: Briefcase },
      { href: "/pipeline", label: "Pipeline", icon: Kanban },
      { href: "/talent-pool", label: "Talent Pool", icon: Users },
      { href: "/shortlists", label: "Shortlists", icon: Bookmark },
    ],
  },
  {
    title: "Management",
    items: [
      { href: "/integrations", label: "Integrations", icon: Plug },
      { href: "/reports", label: "Reports & Analytics", icon: BarChart3 },
    ],
  },
  {
    title: "Administration",
    items: [
      { href: "/settings", label: "Settings", icon: Settings },
      { href: "/team", label: "Team & Permissions", icon: ShieldCheck },
    ],
  },
];

/** Sticky left navigation. Collapses to icons below the md breakpoint. */
export function Sidebar() {
  const pathname = usePathname();
  const [me, setMe] = useState<{ name: string; email: string; role: string; avatarUrl: string | null } | null>(null);
  useEffect(() => {
    fetch("/api/me").then((r) => (r.ok ? r.json() : null)).then(setMe).catch(() => {});
  }, []);

  return (
    <aside className="sticky top-0 flex h-screen w-14 shrink-0 flex-col border-r border-zinc-200 bg-zinc-50 md:w-56">
      <Link href="/" className="flex h-14 items-center gap-2 border-b border-zinc-200 px-3 md:px-4" aria-label="XS-Hunt home">
        <Logo />
      </Link>

      <nav aria-label="Main" className="mt-3 flex flex-1 flex-col gap-4 overflow-y-auto px-2">
        {NAV_GROUPS.map((group) => (
          <div key={group.title} className="flex flex-col gap-0.5">
            <p className="section-tag hidden px-2 pb-1 md:block">{group.title}</p>
            {group.items.map(({ href, label, icon: Icon }) => {
              const active = pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  title={label}
                  className={`flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm transition-colors ${
                    active ? "bg-white font-medium text-zinc-950 shadow-sm ring-1 ring-zinc-200" : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950"
                  }`}
                >
                  <Icon className={`size-4 shrink-0 ${active ? "text-accent" : ""}`} aria-hidden="true" />
                  <span className="hidden md:block">{label}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="border-t border-zinc-200 pt-3">
        <IntegrationsMini />
        <IntegrationsIcons />
        <div className="mx-2 mb-2 flex flex-col items-center gap-2 md:flex-row">
          {me && (
            <div className="hidden min-w-0 flex-1 items-center gap-2 rounded-lg bg-white px-2 py-1.5 ring-1 ring-zinc-200 md:flex" title={me.email}>
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent/15 text-[11px] font-semibold text-accent">{me.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase()}</span>
              <span className="min-w-0"><span className="block truncate text-xs font-medium text-zinc-950">{me.name}</span><span className="block truncate text-[11px] capitalize text-zinc-500">{me.role}</span></span>
            </div>
          )}
          <ThemeToggle compact />
        </div>
        <button
          type="button"
          title="Sign out"
          onClick={async () => {
            await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
            window.location.assign("/login");
          }}
          className="mx-2 mb-2 flex h-9 w-[calc(100%-1rem)] items-center gap-2.5 rounded-lg px-2.5 text-sm text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950"
        >
          <LogOut className="size-4 shrink-0" aria-hidden="true" />
          <span className="hidden md:block">Sign out</span>
        </button>
      </div>
    </aside>
  );
}
