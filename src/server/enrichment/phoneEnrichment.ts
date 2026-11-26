import { getEnv } from "@/server/env";
import { createLogger } from "@/server/logger";
import { extractIndianMobile } from "@/server/sourcing/phone";
import { ApolloPhoneProvider } from "./apollo";

/**
 * Paid / free-tier phone enrichment: the LAST resort, used only for candidates scoring 75%+ whose phone
 * number the free snippet regex could not find. The pipeline guarantees that; this module just does the lookup.
 *
 * Provider: Apollo.io when APOLLO_API_KEY is set (see apollo.ts), otherwise a placeholder that makes no call.
 * Another vendor only needs to implement `PhoneEnrichmentProvider.findPhone`. Mind each vendor's terms and the legal gate in docs/ENRICHMENT.md before enabling it.
 */

/** Default lowest score (inclusive) that may be sent to paid enrichment. Overridable with ENRICHMENT_MIN_SCORE. */
export const DEFAULT_ENRICHMENT_MIN_SCORE = 75;

/**
 * THE credit guard. Paid enrichment is allowed only for candidates scoring AT OR ABOVE `minScore` (default 75)
 * that have no phone yet: not from the free snippet regex, and not already stored from an earlier run.
 */
export function needsPaidEnrichment(input: {
  score: number;
  regexPhone: string | null;
  storedPhone: string | null;
  minScore?: number;
}): boolean {
  return input.score >= (input.minScore ?? DEFAULT_ENRICHMENT_MIN_SCORE) && !input.regexPhone && !input.storedPhone;
}

export interface EnrichmentRequest {
  candidateId: string;
  linkedinUrl: string;
  name: string | null;
  headline: string | null;
}

export interface EnrichmentResult {
  /** E.164 Indian mobile ("+91..."), or null. */
  phone: string | null;
  /** Which provider answered (for the audit trail in candidates.phoneSource). */
  provider: string;
  /** found = phone returned. not_found = looked up, no number. skipped = nothing was called (no provider). error = lookup failed. */
  status: "found" | "not_found" | "skipped" | "error";
  detail?: string;
}

export interface PhoneEnrichmentProvider {
  readonly name: string;
  findPhone(request: EnrichmentRequest): Promise<EnrichmentResult>;
}

/** Stand-in for a free-tier vendor. Makes no network call and costs nothing. */
export class PlaceholderPhoneEnrichment implements PhoneEnrichmentProvider {
  readonly name = "placeholder";
  private readonly log = createLogger("enrichment");

  async findPhone(request: EnrichmentRequest): Promise<EnrichmentResult> {
    this.log.info({ candidateId: request.candidateId }, "phone enrichment requested (placeholder: no vendor configured)");
    return {
      phone: null,
      provider: this.name,
      status: "skipped",
      detail: "No enrichment vendor is connected yet (placeholder for ContactOut / Lusha).",
    };
  }
}

const defaultProvider: PhoneEnrichmentProvider = new PlaceholderPhoneEnrichment();

/** The provider the pipeline uses. Replace the return value to go live. */
export function getPhoneEnrichmentProvider(): PhoneEnrichmentProvider {
  const apolloKey = getEnv().APOLLO_API_KEY;
  return apolloKey ? new ApolloPhoneProvider(apolloKey) : defaultProvider;
}

/**
 * Looks up one candidate's phone. Never throws. Whatever the vendor returns is validated as an Indian mobile
 * number, so a landline or a foreign number from a vendor is never stored as "the" phone.
 */
export async function enrichPhone(
  request: EnrichmentRequest,
  provider: PhoneEnrichmentProvider = getPhoneEnrichmentProvider(),
): Promise<EnrichmentResult> {
  try {
    const result = await provider.findPhone(request);
    if (result.status !== "found") return { ...result, phone: null };
    const phone = extractIndianMobile(result.phone);
    return phone ? { ...result, phone } : { ...result, phone: null, status: "not_found", detail: "Vendor returned no Indian mobile number." };
  } catch (error) {
    return { phone: null, provider: provider.name, status: "error", detail: error instanceof Error ? error.message : String(error) };
  }
}
