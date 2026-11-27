import { IntegrationsGrid } from "@/components/IntegrationsPanel";

export default function IntegrationsPage() {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <header>
        <h1 className="text-2xl font-semibold">Integrations</h1>
        <p className="mt-1 max-w-prose text-sm text-zinc-600">
          Every candidate source feeds the same pipeline, scoring, resume storage and shortlists. LinkedIn, Cutshort and GitHub are
          searched from here; Naukri arrives through the XS-Hunt extension on your premium Resdex account.
        </p>
      </header>
      <IntegrationsGrid />
    </div>
  );
}
