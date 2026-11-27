import type { ReactNode } from "react";
import { AiKeyPrompt } from "@/components/AiKeyPrompt";
import { Sidebar } from "@/components/Sidebar";

/** The signed-in workspace: left navigation + page. The public landing page lives in the (site) group. */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-white">
      <Sidebar />
      <main className="min-w-0 flex-1 bg-white">
        {process.env.OPEN_ACCESS === "true" && (
          <p role="status" className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs text-amber-800">
            Open access is ON: there is no login, so anyone with this URL can see every candidate and resume. Set OPEN_ACCESS=false to require sign-in.
          </p>
        )}
        {children}
        <AiKeyPrompt />
      </main>
    </div>
  );
}
