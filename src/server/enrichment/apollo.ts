import type { EnrichmentRequest, EnrichmentResult, PhoneEnrichmentProvider } from "./phoneEnrichment";

/**
 * Apollo.io people enrichment, looked up by LinkedIn URL:
 *   POST https://api.apollo.io/api/v1/people/match   header: x-api-key   body: { linkedin_url }
 *   -> { person: { phone_numbers: [{ raw_number, sanitized_number, type }], ... } }
 *
 * IMPORTANT, check against Apollo's current docs and your plan before relying on it:
 *  - Apollo bills phone data as separate "mobile credits"; the free plan may include none or very few.
 *  - Revealing a MOBILE number through the API (`reveal_phone_number`) is delivered ASYNCHRONOUSLY to a webhook,
 *    which this app does not have. So this provider reads only what the synchronous match response already
 *    contains. If it has no Indian mobile, the result is "not_found" and no further credit is spent.
 */
const ENDPOINT = "https://api.apollo.io/api/v1/people/match";

interface ApolloPhone {
  raw_number?: string;
  sanitized_number?: string;
  type?: string;
}

export class ApolloPhoneProvider implements PhoneEnrichmentProvider {
  readonly name = "apollo";

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async findPhone(request: EnrichmentRequest): Promise<EnrichmentResult> {
    const response = await this.fetchImpl(ENDPOINT, {
      method: "POST",
      headers: { "x-api-key": this.apiKey, "Content-Type": "application/json", Accept: "application/json", "Cache-Control": "no-cache" },
      body: JSON.stringify({ linkedin_url: request.linkedinUrl }),
    });

    if (response.status === 404) return { phone: null, provider: this.name, status: "not_found" };
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 200);
      return { phone: null, provider: this.name, status: "error", detail: `Apollo ${response.status}: ${detail || response.statusText}` };
    }

    const data = (await response.json().catch(() => null)) as { person?: { phone_numbers?: ApolloPhone[] } | null } | null;
    const numbers = data?.person?.phone_numbers ?? [];
    // Mobile numbers first; enrichPhone() then keeps only a valid Indian mobile.
    const ordered = [...numbers].sort((a, b) => Number(b.type === "mobile") - Number(a.type === "mobile"));
    const phone = ordered.map((n) => n.sanitized_number || n.raw_number).find((value): value is string => Boolean(value)) ?? null;
    return { phone, provider: this.name, status: phone ? "found" : "not_found" };
  }
}
