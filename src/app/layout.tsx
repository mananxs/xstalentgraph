import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import type { ReactNode } from "react";
import { MotionProvider } from "@/components/MotionProvider";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains-mono", display: "swap" });

export const metadata: Metadata = {
  title: "XS-Hunt: AI recruiting agents that source, rank and shortlist",
  description: "Describe the role in plain English. XS-Hunt agents build the rubric, find matching profiles, score each one and rank them. You approve every step.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        {/* Applies the saved theme before first paint, so there is no flash of the wrong colours. */}
        <script dangerouslySetInnerHTML={{ __html: `try{var t=localStorage.getItem("xs-theme");if(t==="dark"||t==="warm"||t==="light")document.documentElement.dataset.theme=t}catch(e){}` }} />
      </head>
      <body className="font-sans antialiased">
        <MotionProvider>{children}</MotionProvider>
      </body>
    </html>
  );
}
