import { Closing } from "@/components/landing/Closing";
import { Enterprise } from "@/components/landing/Enterprise";
import { Faq } from "@/components/landing/Faq";
import { Features } from "@/components/landing/Features";
import { Hero } from "@/components/landing/Hero";
import { Integrations } from "@/components/landing/Integrations";
import { Navbar } from "@/components/landing/Navbar";
import { Stories } from "@/components/landing/Stories";
import { Workflow } from "@/components/landing/Workflow";

/** Public landing page: product-led hero with a live sandbox, then sections [01] to [06]. */
export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white">
      <Navbar />
      <main>
        <Hero />
        <Features />
        <Workflow />
        <Integrations />
        <Stories />
        <Enterprise />
        <Faq />
      </main>
      <Closing />
    </div>
  );
}
