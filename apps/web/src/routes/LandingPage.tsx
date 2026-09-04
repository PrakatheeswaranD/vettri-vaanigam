/**
 * Vettri Vaanigam — the public landing page.
 *
 * ONE STORY, TOLD IN ORDER
 *
 * Each section answers the question the previous one raises, and the page
 * is deliberately not a grid of features:
 *
 *   Hero          what this is, with a transaction crossing the network
 *   Platform      the boundary — AI proposes, policy decides, payments run
 *   Command       what a merchant sees: revenue, fleet, readiness
 *   Buyer         one worked recommendation, with the comparison behind it
 *   Merchant      growth proposals, each with reason → impact → action
 *   Policy        the verdict, computed from four checkable inputs
 *   Ledger        the same transaction as an audit trail
 *   Revenue       whether any of this made money
 *   Failure       what happens when the payment does not complete
 *   Trust         the whole chain, end to end
 *   Demo          run it yourself
 *
 * WHAT THE NUMBERS ARE
 *
 * The figures in the command center and the revenue section are sample
 * data for a test-mode environment, and each panel says so in its own
 * header rather than in fine print at the bottom of the page. A product
 * whose pitch is auditability cannot present invented numbers as measured
 * ones anywhere, including in its own marketing.
 *
 * ART DIRECTION
 *
 * Dark-first, and its own system (`.acos` in index.css) rather than the
 * white operational theme with a filter over it. Colour is signal — green
 * for a success, red only for a failure, cyan/blue/violet for system
 * activity — and the layout leans on hairlines, spacing and one gradient
 * instead of glow. The consoles behind the sign-in stay white and quiet;
 * these are two different jobs and they get two different systems.
 */
import { useEffect } from "react";
import { AgentActionLedger } from "../components/landing/AgentActionLedger";
import { BuyerAgent } from "../components/landing/BuyerAgent";
import { ClosingCta, SiteFooter } from "../components/landing/ClosingCta";
import { CommandCenter } from "../components/landing/CommandCenter";
import { Differentiator } from "../components/landing/Differentiator";
import { FailureSimulation } from "../components/landing/FailureSimulation";
import { Hero } from "../components/landing/Hero";
import { InteractiveDemo } from "../components/landing/InteractiveDemo";
import { MerchantAgent } from "../components/landing/MerchantAgent";
import { Navbar } from "../components/landing/Navbar";
import { PolicyEngine } from "../components/landing/PolicyEngine";
import { RevenueIntelligence } from "../components/landing/RevenueIntelligence";
import { TransactionSpine } from "../components/landing/TransactionSpine";
import { TrustArchitecture } from "../components/landing/TrustArchitecture";

export default function LandingPage() {
  // The consoles behind the sign-in carry their own titles; this one
  // states the product and its promise. Restored on unmount so a
  // navigation into the app does not inherit it.
  useEffect(() => {
    const previous = document.title;
    document.title = "Vettri Vaanigam — Commerce, built for AI.";
    return () => {
      document.title = previous;
    };
  }, []);

  return (
    <div className="acos min-h-screen overflow-x-clip">
      {/* Atmosphere. Painted gradients rather than blurred or blended
          layers: both of those promote the layer to its own composite, and
          a promoted atmosphere layer will paint over the content. */}
      <div aria-hidden className="os-ambient pointer-events-none absolute inset-0 -z-10">
        <div className="os-grid absolute inset-0 [mask-image:linear-gradient(to_bottom,black,transparent_65%)]" />
      </div>

      <Navbar />
      <TransactionSpine />

      <main>
        <Hero />
        <Differentiator />
        <CommandCenter />
        <BuyerAgent />
        <MerchantAgent />
        <PolicyEngine />
        <AgentActionLedger />
        <RevenueIntelligence />
        <FailureSimulation />
        <TrustArchitecture />
        <InteractiveDemo />
        <ClosingCta />
      </main>

      <SiteFooter />
    </div>
  );
}
