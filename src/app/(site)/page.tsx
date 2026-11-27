import { Describe } from "@/components/landing/Describe";
import { Faq, Footer, Humans, RolesMarquee, Stats } from "@/components/landing/Closing";
import { Hero } from "@/components/landing/Hero";
import { HireBox } from "@/components/landing/HireBox";
import { Journey } from "@/components/landing/Journey";
import { SmoothScroll } from "@/components/landing/kinetic";
import { Nav } from "@/components/landing/Nav";
import { Stack } from "@/components/landing/Stack";
import { Workflow } from "@/components/landing/Workflow";

/** Public landing page. Only features that exist are shown as live; anything planned is labelled "Coming soon". */
export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white">
      <SmoothScroll />
      <Nav />
      <main>
        <Hero />
        <RolesMarquee />
        <Describe />
        <Stack />
        <Workflow />
        <Journey />
        <HireBox />
        <Humans />
        <Stats />
        <Faq />
      </main>
      <Footer />
    </div>
  );
}
