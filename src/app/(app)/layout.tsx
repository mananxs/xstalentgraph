import type { ReactNode } from "react";
import { Sidebar } from "@/components/Sidebar";

/** The signed-in workspace: left navigation + page. The public landing page lives in the (site) group. */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-white">
      <Sidebar />
      <main className="min-w-0 flex-1 bg-white">{children}</main>
    </div>
  );
}
