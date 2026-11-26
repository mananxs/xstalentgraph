import { Plug, ShieldCheck, UserCheck } from "lucide-react";
import { SectionHeader } from "./ui";

const ITEMS = [
  { icon: ShieldCheck, title: "SOC 2 Type II", body: "Security controls audited against the SOC 2 Trust Services Criteria." },
  { icon: UserCheck, title: "SSO & Access Control", body: "Single sign-on, role-based access and an audit trail for every shortlist change." },
  { icon: Plug, title: "Native Integrations", body: "Connect Naukri, LinkedIn, Cutshort and GitHub without moving data through third parties." },
];

export function Enterprise() {
  return (
    <section id="enterprise" className="border-b border-zinc-200 bg-zinc-50 py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeader tag="[05] enterprise ready" title="Built for teams that answer to security reviews" />
        <ul className="mt-12 grid overflow-hidden rounded-2xl border border-zinc-200 bg-white md:grid-cols-3">
          {ITEMS.map(({ icon: Icon, title, body }, index) => (
            <li key={title} className={`p-6 ${index > 0 ? "border-t border-zinc-200 md:border-l md:border-t-0" : ""}`}>
              <Icon className="size-6 text-zinc-950" strokeWidth={1.5} aria-hidden="true" />
              <h3 className="mt-4 text-base font-semibold text-zinc-950">{title}</h3>
              <p className="mt-1.5 text-sm text-zinc-600">{body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
