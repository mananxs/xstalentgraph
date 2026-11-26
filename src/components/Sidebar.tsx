"use client";

import { Bookmark, Briefcase, FileSearch, LayoutDashboard, Plug, Settings } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { IntegrationsIcons, IntegrationsMini } from "./IntegrationsPanel";
import { Logo } from "./Logo";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

const NAV_GROUPS: Array<{ title: string; items: NavItem[] }> = [
  {
    title: "Sourcing",
    items: [
      { href: "/pipeline", label: "Pipeline", icon: LayoutDashboard },
      { href: "/jobs", label: "Jobs", icon: Briefcase },
      { href: "/shortlists", label: "Shortlists", icon: Bookmark },
    ],
  },
  { title: "Modules", items: [{ href: "/resume-match", label: "Resume Match", icon: FileSearch }] },
  {
    title: "Platform",
    items: [
      { href: "/integrations", label: "Integrations", icon: Plug },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

/** Sticky left navigation. Collapses to icons below the md breakpoint. */
export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="sticky top-0 flex h-screen w-14 shrink-0 flex-col border-r border-zinc-200 bg-zinc-50 md:w-56">
      <Link href="/" className="flex h-14 items-center gap-2 border-b border-zinc-200 px-3 md:px-4" aria-label="TalentGraph home">
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
      </div>
    </aside>
  );
}
