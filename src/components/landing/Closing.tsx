import Link from "next/link";
import { Logo } from "../Logo";
import { APP_HREF, DEMO_HREF } from "./data";
import { btnSecondary } from "./ui";

const COLUMNS = [
  { title: "Product", links: [["Features", "#features"], ["Workflows", "#workflows"], ["Integrations", "#integrations"]] },
  { title: "Company", links: [["Customers", "#stories"], ["Enterprise", "#enterprise"], ["Book a demo", DEMO_HREF]] },
  { title: "Resources", links: [["FAQ", "#faq"], ["Open the app", APP_HREF], ["Naukri extension", "#integrations"]] },
];

export function Closing() {
  return (
    <>
      <section className="bg-white px-4 py-16 sm:px-6">
        <div className="mx-auto max-w-6xl rounded-2xl bg-zinc-950 px-6 py-14 text-center">
          <h2 className="mx-auto max-w-xl text-3xl font-semibold text-white sm:text-4xl">Your next hire is already in your pipeline</h2>
          <p className="mx-auto mt-3 max-w-md text-base text-zinc-300">Bring your first job description and see a ranked shortlist in minutes.</p>
          <div className="mt-7 flex flex-col items-center justify-center gap-2 sm:flex-row">
            <Link href={APP_HREF} className="inline-flex h-9 w-full items-center justify-center rounded-lg bg-white px-4 text-sm font-medium text-zinc-950 hover:bg-zinc-100 sm:w-auto">
              Try for free
            </Link>
            <a href={DEMO_HREF} className={`${btnSecondary} w-full border-zinc-700 bg-transparent text-white hover:bg-zinc-900 sm:w-auto`}>
              Book a demo
            </a>
          </div>
        </div>
      </section>
      <footer className="border-t border-zinc-200 bg-white">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:grid-cols-2 sm:px-6 lg:grid-cols-[2fr_1fr_1fr_1fr]">
          <div>
            <Logo alwaysShowName />
            <p className="mt-3 max-w-xs text-sm text-zinc-600">One workspace for sourcing, ranking and shortlisting across every candidate source.</p>
          </div>
          {COLUMNS.map((column) => (
            <nav key={column.title} aria-label={column.title}>
              <p className="section-tag mb-3">{column.title}</p>
              <ul className="space-y-2">
                {column.links.map(([label, href]) => (
                  <li key={label}>
                    <a href={href} className="text-sm text-zinc-700 hover:text-zinc-950">
                      {label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <div className="border-t border-zinc-200 px-4 py-5 text-center text-xs text-zinc-500">
          <span className="tabular-nums">&copy; {new Date().getFullYear()}</span> TalentGraph. All rights reserved.
        </div>
      </footer>
    </>
  );
}
