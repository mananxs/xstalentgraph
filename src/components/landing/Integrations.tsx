import { Database, FileText, Globe, Mail, MessageCircle, Table2, Webhook } from "lucide-react";
import type { ReactNode } from "react";
import { INTEGRATION_LOGOS } from "../BrandLogos";
import { SectionHeader } from "./ui";

const SOURCES: Array<{ name: string; icon: ReactNode }> = [
  { name: "Naukri", icon: <INTEGRATION_LOGOS.naukri size={20} className="grayscale" /> },
  { name: "LinkedIn", icon: <INTEGRATION_LOGOS.linkedin size={20} className="grayscale" /> },
  { name: "Cutshort", icon: <INTEGRATION_LOGOS.cutshort size={20} className="grayscale" /> },
  { name: "GitHub", icon: <INTEGRATION_LOGOS.github size={20} className="text-zinc-700" /> },
];

const MORE: Array<{ name: string; icon: ReactNode }> = [
  { name: "Gmail", icon: <Mail className="size-5 text-zinc-700" aria-hidden="true" /> },
  { name: "WhatsApp", icon: <MessageCircle className="size-5 text-zinc-700" aria-hidden="true" /> },
  { name: "Google Sheets", icon: <Table2 className="size-5 text-zinc-700" aria-hidden="true" /> },
  { name: "Webhooks", icon: <Webhook className="size-5 text-zinc-700" aria-hidden="true" /> },
  { name: "Resume storage", icon: <FileText className="size-5 text-zinc-700" aria-hidden="true" /> },
  { name: "Postgres", icon: <Database className="size-5 text-zinc-700" aria-hidden="true" /> },
];

function Tile({ name, icon }: { name: string; icon: ReactNode }) {
  return (
    <li className="flex h-14 items-center gap-3 rounded-xl border border-zinc-200 bg-white px-4 text-sm text-zinc-900">
      {icon}
      {name}
    </li>
  );
}

export function Integrations() {
  return (
    <section id="integrations" className="border-b border-zinc-200 bg-zinc-50 py-20">
      <div className="mx-auto max-w-4xl px-4 sm:px-6">
        <SectionHeader tag="[03] integrations" title="Every source, one workspace">
          Search where candidates already are, and keep what you find in a single system.
        </SectionHeader>
        <ul className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {SOURCES.map((item) => (
            <Tile key={item.name} {...item} />
          ))}
        </ul>
        <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {MORE.map((item) => (
            <Tile key={item.name} {...item} />
          ))}
        </ul>
        <p className="mt-5 flex items-center justify-center gap-2 text-sm text-zinc-600">
          <Globe className="size-4" aria-hidden="true" />
          <span className="font-mono tabular-nums">+ 40 more</span> through webhooks and the open API
        </p>
      </div>
    </section>
  );
}
