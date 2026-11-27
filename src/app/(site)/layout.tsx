import { Instrument_Serif, Plus_Jakarta_Sans } from "next/font/google";
import type { ReactNode } from "react";

const display = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-display", display: "swap", weight: ["400", "500", "600", "700", "800"] });
const serif = Instrument_Serif({ subsets: ["latin"], variable: "--font-serif", display: "swap", weight: "400", style: "italic" });

/** The public site has its own type: tight geometric sans for headlines, an italic serif for the one accented word. */
export default function SiteLayout({ children }: { children: ReactNode }) {
  return <div className={`xs-land ${display.variable} ${serif.variable}`}>{children}</div>;
}
