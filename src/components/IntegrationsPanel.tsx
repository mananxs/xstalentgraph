"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { IntegrationDto } from "@/lib/types";
import { INTEGRATION_LOGOS } from "./BrandLogos";

/** Default view before the API answers: GitHub live, the rest on the roadmap. */
const FALLBACK: IntegrationDto[] = [
  { id: "github", name: "GitHub", status: "connected", detail: "Public profiles, languages and repository topics" },
  { id: "linkedin", name: "LinkedIn", status: "not_connected", detail: "Checking Apify configuration..." },
  { id: "naukri", name: "Naukri", status: "not_connected", detail: "Checking the extension key..." },
  { id: "indeed", name: "Indeed", status: "coming_soon", detail: "Resume search and job applicants" },
];

export function useIntegrations() {
  const [integrations, setIntegrations] = useState<IntegrationDto[]>(FALLBACK);
  useEffect(() => {
    let cancelled = false;
    api
      .listIntegrations()
      .then((response) => !cancelled && setIntegrations(response.integrations))
      .catch(() => {
        /* keep the fallback: this panel must never break the layout */
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return integrations;
}

function StatusDot({ status }: { status: IntegrationDto["status"] }) {
  const color = status === "connected" ? "bg-emerald-500" : status === "not_connected" ? "bg-amber-500" : "bg-zinc-300";
  return <span aria-hidden="true" className={`size-2 rounded-full ${color}`} />;
}

const STATUS_LABEL: Record<IntegrationDto["status"], string> = {
  connected: "Connected",
  not_connected: "Not connected",
  coming_soon: "Coming soon",
};

/** Compact list for the sidebar: GitHub glows green when connected, the others are greyed out. */
export function IntegrationsMini() {
  const integrations = useIntegrations();
  return (
    <div className="hidden px-3 pb-4 md:block">
      <p className="mb-2 px-2 text-[11px] font-medium uppercase tracking-wider text-zinc-500">Integrations</p>
      <ul className="flex flex-col gap-0.5">
        {integrations.map((integration) => {
          const Logo = INTEGRATION_LOGOS[integration.id];
          const live = integration.status === "connected";
          return (
            <li
              key={integration.id}
              title={`${integration.name}: ${STATUS_LABEL[integration.status]}`}
              className={`flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm ${live ? "text-zinc-800" : "text-zinc-500"}`}
            >
              <Logo size={18} className={live ? "text-emerald-700" : integration.status === "not_connected" ? "text-amber-700" : "opacity-40 grayscale"} />
              <span className="flex-1 truncate">{integration.name}</span>
              {integration.status === "coming_soon" ? (
                <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-500">Soon</span>
              ) : (
                <StatusDot status={integration.status} />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Icon-only strip for the collapsed (mobile) sidebar. */
export function IntegrationsIcons() {
  const integrations = useIntegrations();
  return (
    <ul className="flex flex-col items-center gap-2 pb-4 md:hidden" aria-label="Integrations">
      {integrations.map((integration) => {
        const Logo = INTEGRATION_LOGOS[integration.id];
        const live = integration.status === "connected";
        return (
          <li key={integration.id} title={`${integration.name}: ${STATUS_LABEL[integration.status]}`}>
            <Logo size={18} className={live ? "text-emerald-700" : "opacity-40 grayscale"} />
          </li>
        );
      })}
    </ul>
  );
}

/** Full cards for the Integrations page. */
export function IntegrationsGrid() {
  const integrations = useIntegrations();
  return (
    <ul className="grid gap-4 sm:grid-cols-2">
      {integrations.map((integration) => {
        const Logo = INTEGRATION_LOGOS[integration.id];
        const live = integration.status === "connected";
        return (
          <li
            key={integration.id}
            className={`card-surface flex items-start gap-4 rounded-2xl border p-5 ${
              live ? "border-emerald-200" : "border-zinc-200"
            }`}
          >
            <div className={`flex size-12 shrink-0 items-center justify-center rounded-xl ${live ? "bg-emerald-50" : "bg-zinc-100"}`}>
              <Logo size={28} className={live ? "text-emerald-700" : integration.status === "not_connected" ? "text-amber-700" : "opacity-50 grayscale"} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h3 className="font-medium text-zinc-950">{integration.name}</h3>
                <span
                  className={`flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] ${
                    live
                      ? "bg-emerald-50 text-emerald-700"
                      : integration.status === "not_connected"
                        ? "bg-amber-50 text-amber-700"
                        : "bg-zinc-100 text-zinc-600"
                  }`}
                >
                  <StatusDot status={integration.status} />
                  {STATUS_LABEL[integration.status]}
                </span>
              </div>
              <p className="mt-1 text-sm text-zinc-600">{integration.detail}</p>
              {!live && integration.status === "coming_soon" && (
                <p className="mt-3 text-xs text-zinc-500">Not active yet. It will plug into the same pipeline and scoring.</p>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
