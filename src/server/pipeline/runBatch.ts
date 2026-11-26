import type { Logger } from "pino";
import { createLimiter } from "@/server/ai/concurrency";
import { embedTexts } from "@/server/ai/embeddings";
import { parseProfileText, scoreCandidate, TIER1_THRESHOLD, XRAY_HEURISTIC_MODEL } from "@/server/ai/heuristic";
import { CandidateMatcher } from "@/server/ai/matcher";
import { buildProfileText, buildSerpProfileText } from "@/server/ai/profileText";
import { enrichPhone, needsPaidEnrichment } from "@/server/enrichment/phoneEnrichment";
import { getEnv } from "@/server/env";
import { GitHubClient } from "@/server/github/client";
import { buildSearchQueries } from "@/server/github/searchQueries";
import { linkedinIdFromUrl, linkedinUrlFromId } from "@/server/linkedin/profileMapper";
import { extractIndianMobile } from "@/server/sourcing/phone";
import { CutshortClient, CutshortError, type CutshortHit } from "@/server/sourcing/providers/cutshort/client";
import { buildCutshortProfileText } from "@/server/sourcing/providers/cutshort/profile";
import { buildCutshortSearch } from "@/server/sourcing/providers/cutshort/search";
import { ApifySerpProvider } from "@/server/sourcing/providers/search/apifySerp";
import type { SerpCandidate } from "@/server/sourcing/providers/search/types";
import { createLogger } from "@/server/logger";
import {
  completeBatch,
  failBatch,
  incrementBatchResult,
  updateBatchCounters,
  type ClaimedBatch,
} from "@/server/repositories/batchRepository";
import {
  findCandidatesMissingEmbedding,
  saveCandidateEmbedding,
  listCutshortUnlockCandidates,
  saveCutshortContact,
  saveEnrichedPhone,
  upsertCandidates,
  upsertCutshortCandidates,
  upsertSerpCandidates,
} from "@/server/repositories/candidateRepository";
import { findJobById, type JobDetails } from "@/server/repositories/jobRepository";
import {
  createPendingMatches,
  listPendingEvaluations,
  listTopFreeScoredMatches,
  markMatchCompleted,
  markMatchFailed,
  resetUnscoredMatches,
  type PendingEvaluation,
} from "@/server/repositories/matchRepository";
import { getDecryptedToken } from "@/server/repositories/tokenRepository";

/** GitHub users per request. Small pages mean the first candidates show up on screen sooner. */
const GITHUB_PAGE_SIZE = 10;
/** How many embeddings are requested and saved per round. */
const EMBED_CHUNK_SIZE = 50;
/** Candidates the AI reviews per call. Small enough for a free-tier token budget, big enough to save calls. */
const REVIEW_BATCH_SIZE = 5;

/**
 * Runs the whole pipeline for one claimed batch. It is a STREAM, not a sequence of big steps:
 *
 *   old unscored candidates ------------------------------> score
 *   GitHub page 1 -> save -> pending row (visible in UI) --> score
 *   GitHub page 2 -> save -> pending row (visible in UI) --> score   (GitHub keeps searching meanwhile)
 *   ...
 *
 * LinkedIn runs stream the same way, one Apify search run at a time, and cost almost nothing per candidate:
 *
 *   Google X-Ray micro-queries (Apify) -> name + URL + snippet
 *     -> phone regex on the snippet (free) -> save -> weighted heuristic score (free)
 *     -> score >= 75% AND no phone found -> Apollo enrichment
 *     -> afterwards the AI reviews the top N for real role fit (AI_RESCORE_TOP_N, a few per call) (the only step that can cost credits)
 *
 * So candidates appear in the dashboard right after each GitHub page / Apify run, and their scores fill in
 * (and the ranking re-sorts) while the search is still going.
 * Never throws: any fatal problem marks the batch as failed with the error text saved.
 */
export async function runBatch(batch: ClaimedBatch): Promise<void> {
  const log = createLogger("pipeline").child({ batchId: batch.id, jobId: batch.jobId });
  log.info("batch started");

  try {
    await executeBatch(batch, log);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error({ err: error }, "batch failed");
    await failBatch(batch.id, message);
  }
}

async function executeBatch(batch: ClaimedBatch, log: Logger): Promise<void> {
  const env = getEnv();

  const job = await findJobById(batch.jobId);
  if (!job) throw new Error("The job no longer exists.");

  // Scoring setup. `limit` makes sure we never call Gemini more than EVAL_CONCURRENCY times at once,
  // no matter how many pages are being processed.
  // The shared client keeps model cooldowns and the circuit breaker across runs.
  const matcher = new CandidateMatcher();
  const limit = createLimiter(env.EVAL_CONCURRENCY);
  const scheduledMatchIds = new Set<string>();
  const backgroundWork: Promise<void>[] = [];
  const scoring = { failed: 0, firstError: "", quick: 0, quickReason: "" };
  /** LinkedIn tiering counters, reported in the batch note. */
  /** Problems with a candidate source (Apify, Cutshort). Shown to the recruiter; successes never are. */
  const sourceNotes: string[] = [];
  /** Set when CUTSHORT_API_KEY is configured and this is a LinkedIn-source run. */
  const cutshort = { client: null as CutshortClient | null, found: 0, unlockFailed: "" };
  const tiers = { scored: 0, tier1: 0, phoneFromSnippet: 0, enrichTried: 0, enrichFound: 0, enrichCapped: 0 };

  /** Queues scoring for matches we have not queued yet. Does not wait for the scoring to finish. */
  function scheduleScoring(pending: PendingEvaluation[]): void {
    for (const item of pending) {
      if (scheduledMatchIds.has(item.matchId)) continue;
      scheduledMatchIds.add(item.matchId);
      backgroundWork.push(limit(() => scoreOne(item)));
    }
  }

  /**
   * Scores one candidate and saves the result. Never throws.
   * The AI is tried first; if it is unavailable the offline Quick score is used, so a candidate is only
   * marked "failed" when even saving the result goes wrong (for example the database is unreachable).
   */
  async function scoreOne(item: PendingEvaluation): Promise<void> {
    try {
      const result = await matcher.evaluateSafely(job as JobDetails, item.profileText);
      if (result.fallbackReason) {
        scoring.quick += 1;
        scoring.quickReason ||= result.fallbackReason;
        log.warn({ matchId: item.matchId, reason: result.fallbackReason.slice(0, 200) }, "AI unavailable, used Quick score");
      }
      await markMatchCompleted(item.matchId, result);
      await incrementBatchResult(batch.id, "evaluated");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      scoring.failed += 1;
      scoring.firstError ||= message;
      log.warn({ matchId: item.matchId, err: message }, "candidate evaluation failed");
      try {
        await markMatchFailed(item.matchId, env.LLM_MODEL, message);
        await incrementBatchResult(batch.id, "failed");
      } catch (saveError) {
        log.error({ err: saveError }, "could not save the failed state");
      }
    }
  }

  // ---- 0. candidates left over from earlier runs (failed or never scored) are scored again first ----
  await resetUnscoredMatches(batch.jobId, batch.id, { includeQuickScores: matcher.aiAvailable });
  scheduleScoring(await listPendingEvaluations(batch.id));
  await updateBatchCounters(batch.id, { evaluationTotal: scheduledMatchIds.size });

  // ---- 1. search GitHub page by page (skipped for "score only" runs) ----
  const searchGithub = batch.source === "github" && batch.maxProfiles > 0;
  // External sources are switched on per run in the UI and stored as e.g. "linkedin+cutshort".
  const chosen = batch.source.split("+");
  const useApify = chosen.includes("linkedin");
  const useCutshort = chosen.includes("cutshort");
  const scrapeLinkedIn = useApify || useCutshort; // X-Ray search (Apify), Cutshort, or pasted URLs
  let profilesFound = 0;
  let embeddedCount = 0;

  if (searchGithub) {
    const token = await getDecryptedToken(batch.requestedById, "github");
    if (!token) throw new Error("This recruiter has no GitHub token stored. Run: npx prisma db seed");

    const client = new GitHubClient({ token, pageSize: GITHUB_PAGE_SIZE });
    const queries = buildSearchQueries(job);

    await client.searchProfiles(queries, batch.maxProfiles, {
      onNewProfiles: async (profiles) => {
        // Save them. From now on they are visible in the dashboard as "scoring".
        const idByGithubId = await upsertCandidates(
          profiles.map((profile) => ({ profile, profileText: buildProfileText(profile) })),
        );
        const candidateIds = [...idByGithubId.values()];
        await createPendingMatches({ jobId: batch.jobId, batchId: batch.id, candidateIds });

        // Start scoring right away. The next GitHub page is fetched while Gemini works.
        scheduleScoring(await listPendingEvaluations(batch.id));

        profilesFound += profiles.length;
        await updateBatchCounters(batch.id, {
          profilesFound,
          candidatesUpserted: profilesFound,
          evaluationTotal: scheduledMatchIds.size,
        });

        // Embeddings are a bonus (not needed for scoring), so they run in the background and never fail the batch.
        if (env.GEMINI_API_KEY) backgroundWork.push(
          embedMissing(candidateIds, log).then(async (count) => {
            embeddedCount += count;
            await updateBatchCounters(batch.id, { embeddedCount });
          }),
        );
      },
    });
    log.info({ profilesFound }, "github search done");

    if (profilesFound === 0 && scheduledMatchIds.size === 0) {
      throw new Error(
        "GitHub returned no profiles for this job's languages and locations. Try a broader location or another language.",
      );
    }
  }

  // ---- 1b. LinkedIn: Google X-Ray search (Apify) -> snippet -> free phone regex -> free weighted score ----
  if (scrapeLinkedIn) {
    /** Candidates of the current page by database id, so a pending match can be scored from its own snippet. */
    /** Candidates (from Apify or Cutshort) that the free heuristic scores. They are never sent to the AI one by one. */
    const freeScoredIds = new Set<string>();
    const serpByCandidateId = new Map<string, { serp: SerpCandidate; regexPhone: string | null; storedPhone: string | null }>();

    /**
     * Scores one X-Ray candidate with the free weighted heuristic and saves the result. Never throws.
     * A score at or above ENRICHMENT_MIN_SCORE (75) with no phone from the regex and none stored yet is the ONLY case that
     * reaches the (paid) enrichment fallback, capped per run. Everything else costs nothing.
     */
    async function scoreSerpOne(item: PendingEvaluation): Promise<void> {
      const known = serpByCandidateId.get(item.candidateId);
      try {
        const result = scoreCandidate(job as JobDetails, item.profileText, { model: XRAY_HEURISTIC_MODEL });
        await markMatchCompleted(item.matchId, result);
        await incrementBatchResult(batch.id, "evaluated");
        tiers.scored += 1;
        log.debug({ matchId: item.matchId, score: result.score, breakdown: result.breakdown }, "x-ray candidate scored");

        if (result.score > TIER1_THRESHOLD) tiers.tier1 += 1;
        // Below ENRICHMENT_MIN_SCORE (75): never spend credits. With a phone (snippet or stored): nothing to buy either.
        if (!known || !needsPaidEnrichment({ score: result.score, regexPhone: known.regexPhone, storedPhone: known.storedPhone, minScore: env.ENRICHMENT_MIN_SCORE })) return;
        if (tiers.enrichTried >= env.ENRICHMENT_MAX_PER_BATCH) {
          tiers.enrichCapped += 1;
          return;
        }
        tiers.enrichTried += 1;
        const enriched = await enrichPhone({
          candidateId: item.candidateId,
          linkedinUrl: known.serp.linkedinUrl,
          name: known.serp.name,
          headline: known.serp.headline,
        });
        if (enriched.phone) {
          await saveEnrichedPhone(item.candidateId, enriched.phone, enriched.provider);
          tiers.enrichFound += 1;
        }
        log.info({ matchId: item.matchId, status: enriched.status, provider: enriched.provider }, "candidate above enrichment threshold has no phone: enrichment tried");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        scoring.failed += 1;
        scoring.firstError ||= message;
        log.warn({ matchId: item.matchId, err: message }, "x-ray candidate scoring failed");
        try {
          await markMatchFailed(item.matchId, XRAY_HEURISTIC_MODEL, message);
          await incrementBatchResult(batch.id, "failed");
        } catch (saveError) {
          log.error({ err: saveError }, "could not save the failed state");
        }
      }
    }

    /** Saves one batch of SERP candidates (idempotent) and starts scoring the new ones right away. */
    async function ingestSerpPage(page: SerpCandidate[]): Promise<void> {
      const parsed = page.map((serp) => {
        // The phone regex runs on the raw title + snippet exactly as Google returned them.
        const regexPhone = extractIndianMobile(`${serp.rawTitle} ${serp.snippet}`);
        return {
          serp,
          regexPhone,
          profileText: buildSerpProfileText({ headline: serp.headline, location: serp.location, snippet: serp.snippet }),
        };
      });

      // Only a LinkedIn URL is required. Name, headline, location and phone are optional; no email is needed.
      const saved = await upsertSerpCandidates(
        parsed.map(({ serp, regexPhone, profileText }) => ({
          linkedinId: serp.linkedinId,
          linkedinUrl: serp.linkedinUrl,
          name: serp.name,
          headline: serp.headline,
          bio: parseProfileText(profileText).bio.slice(0, 500) || null,
          location: serp.location,
          profileText,
          phone: regexPhone,
        })),
      );

      const byLinkedinId = new Map(parsed.map((entry) => [entry.serp.linkedinId, entry]));
      for (const row of saved) {
        const entry = byLinkedinId.get(row.linkedinId);
        if (!entry) continue;
        serpByCandidateId.set(row.id, { serp: entry.serp, regexPhone: entry.regexPhone, storedPhone: row.phone });
        if (entry.regexPhone) tiers.phoneFromSnippet += 1;
      }

      const candidateIds = saved.map((row) => row.id);
      await createPendingMatches({ jobId: batch.jobId, batchId: batch.id, candidateIds });

      for (const id of candidateIds) freeScoredIds.add(id);
      await scheduleFreeScoring(saved.length);
    }

    /**
     * Starts the free scoring of the pending matches that came from Apify / Cutshort. They are NOT sent to the AI one by
     * one (that would cost credits); the best few get an AI review after the search. No embeddings are made for them.
     */
    async function scheduleFreeScoring(added: number): Promise<void> {
      for (const item of await listPendingEvaluations(batch.id)) {
        if (scheduledMatchIds.has(item.matchId) || !freeScoredIds.has(item.candidateId)) continue;
        scheduledMatchIds.add(item.matchId);
        backgroundWork.push(limit(() => scoreSerpOne(item)));
      }
      profilesFound += added;
      await updateBatchCounters(batch.id, {
        profilesFound,
        candidatesUpserted: profilesFound,
        evaluationTotal: scheduledMatchIds.size,
      });
    }

    /** Saves one page of Cutshort hits and starts scoring them. Their resume text makes the free score much better informed. */
    async function ingestCutshortPage(hits: CutshortHit[]): Promise<void> {
      if (hits.length === 0) return;
      const idByCutshortId = await upsertCutshortCandidates(
        hits.map((hit) => ({
          cutshortId: hit.talentCardId,
          headline: hit.workHistory[0] ?? hit.currentCompany,
          bio: summaryOf(hit),
          location: hit.currentLocation,
          experienceYears: hit.experienceYears,
          profileText: buildCutshortProfileText(hit),
        })),
      );
      const candidateIds = [...idByCutshortId.values()];
      await createPendingMatches({ jobId: batch.jobId, batchId: batch.id, candidateIds });
      for (const id of candidateIds) freeScoredIds.add(id);
      cutshort.found += candidateIds.length;
      await scheduleFreeScoring(candidateIds.length);
    }

    /**
     * Cutshort: one search per page of 20, sequential (Cutshort asks for that), never more than the run cap and never
     * more than the searches the workspace has left. If the strict location filter finds nobody, retry once without it.
     */
    async function searchCutshort(client: CutshortClient): Promise<void> {
      let searchesLeft = env.CUTSHORT_MAX_SEARCHES_PER_RUN;
      try {
        const usage = await client.usage();
        searchesLeft = Math.min(searchesLeft, Math.max(0, usage.searches.limit - usage.searches.used));
      } catch {
        /* usage is a courtesy check; the search itself reports a real quota error */
      }
      if (searchesLeft === 0) {
        sourceNotes.push("Cutshort was skipped: no searches are left in this billing cycle.");
        return;
      }

      let params = buildCutshortSearch(job as JobDetails);
      for (let page = 1; searchesLeft > 0 && cutshort.found < batch.maxProfiles; page += 1) {
        let result = await client.search(params, page);
        searchesLeft -= 1;
        if (page === 1 && result.hits.length === 0 && params.locations && searchesLeft > 0) {
          params = { ...params, locations: undefined };
          result = await client.search(params, page);
          searchesLeft -= 1;
        }
        await ingestCutshortPage(result.hits.slice(0, Math.max(0, batch.maxProfiles - cutshort.found)));
        if (result.hits.length < result.pageSize) break;
      }
    }

    if (batch.linkedinUrls.length > 0) {
      // Recruiter pasted profile URLs: nothing to search. They are saved as URL-only candidates (no snippet), which
      // is enough to be stored; they score low until there is text to score.
      const urls = batch.linkedinUrls.flatMap((url) => {
        const id = linkedinIdFromUrl(url);
        return id ? [id] : [];
      });
      await ingestSerpPage(
        [...new Set(urls)].map((id) => ({
          linkedinId: id,
          linkedinUrl: linkedinUrlFromId(id),
          name: null,
          headline: null,
          location: null,
          rawTitle: "",
          snippet: "",
          query: "",
        })),
      );
    } else {
      if (useApify && !env.APIFY_API_TOKEN) throw new Error("LinkedIn is switched on but APIFY_API_TOKEN is not set.");
      if (useCutshort && !env.CUTSHORT_API_KEY) throw new Error("Cutshort is switched on but CUTSHORT_API_KEY is not set.");
      let firstError: unknown;

      if (useApify && env.APIFY_API_TOKEN) {
        try {
          const provider = new ApifySerpProvider({
            apiToken: env.APIFY_API_TOKEN,
            actorId: env.APIFY_GOOGLE_SEARCH_ACTOR,
            queriesPerRun: env.APIFY_QUERIES_PER_RUN,
            maxPagesPerQuery: env.APIFY_MAX_PAGES_PER_QUERY,
            maxQueries: env.XRAY_MAX_QUERIES,
          });
          const discovery = await provider.discover(job, batch.maxProfiles, ingestSerpPage);
          log.info(
            { found: discovery.candidates.length, queries: discovery.queriesTried.length, perQuery: discovery.resultsPerQuery },
            "linkedin x-ray discovery done",
          );
        } catch (error) {
          firstError ??= error;
          log.warn({ err: error instanceof Error ? error.message : String(error) }, "linkedin search failed");
          if (useCutshort) sourceNotes.push(`LinkedIn search failed: ${error instanceof Error ? error.message.slice(0, 160) : "unknown error"}`);
        }
      }

      if (useCutshort && env.CUTSHORT_API_KEY) {
        try {
          cutshort.client = new CutshortClient({ apiKey: env.CUTSHORT_API_KEY, baseUrl: env.CUTSHORT_API_BASE_URL });
          await searchCutshort(cutshort.client);
          log.info({ found: cutshort.found }, "cutshort search done");
        } catch (error) {
          firstError ??= error;
          log.warn({ err: error instanceof Error ? error.message : String(error) }, "cutshort search failed");
          sourceNotes.push(`Cutshort search failed: ${error instanceof Error ? error.message.slice(0, 160) : "unknown error"}`);
        }
      }

      if (profilesFound === 0) {
        if (firstError) throw firstError;
        throw new Error("No profiles were found for this job. Try a more common title or skill, or a broader skill list.");
      }
    }
    log.info({ profilesFound, ...tiers }, "linkedin sourcing done");

    if (profilesFound === 0 && scheduledMatchIds.size === 0) {
      throw new Error("No usable LinkedIn profiles were found. Check that the URLs are public /in/ profile links.");
    }
  }

  // ---- 2. wait for the scoring (and embeddings) that are still running ----
  // allSettled: one broken background task must never stop the others from being awaited.
  await Promise.allSettled(backgroundWork);

  // ---- 2b. LinkedIn only: the AI reviews the TOP candidates for real role fit (a few per call, token-cheap) ----
  // Everyone was already scored for free. The free score only counts keywords, so the AI (Groq first, then Gemini)
  // now reads the best AI_RESCORE_TOP_N against the full job description and judges whether each person is really
  // the right kind of candidate. Its score replaces the free one for those people. If the AI fails, the free
  // scores stay and the batch note says so.
  const review = { tried: 0, done: 0 };
  if (scrapeLinkedIn && env.AI_RESCORE_TOP_N > 0 && matcher.aiAvailable) {
    const top = await listTopFreeScoredMatches(batch.id, env.AI_RESCORE_TOP_N);
    const groups: PendingEvaluation[][] = [];
    for (let start = 0; start < top.length; start += REVIEW_BATCH_SIZE) groups.push(top.slice(start, start + REVIEW_BATCH_SIZE));
    review.tried = top.length;

    await Promise.allSettled(
      groups.map((group) =>
        limit(async () => {
          try {
            const results = await matcher.evaluateBatch(job as JobDetails, group.map((item) => ({ id: item.matchId, profileText: item.profileText })));
            for (const [matchId, result] of results) {
              await markMatchCompleted(matchId, result);
              review.done += 1;
            }
          } catch (error) {
            log.warn({ err: error instanceof Error ? error.message : String(error), size: group.length }, "AI review failed, kept free scores");
          }
        }),
      ),
    );
    log.info(review, "top candidates reviewed by AI");
  }

  // ---- 2c. Cutshort: unlock contact details for the best matches only (each unlock costs an irreversible credit) ----
  if (cutshort.client && cutshort.found > 0 && env.CUTSHORT_MAX_UNLOCKS_PER_RUN > 0) {
    try {
      const usage = await cutshort.client.usage();
      const credits = Math.min(env.CUTSHORT_MAX_UNLOCKS_PER_RUN, Math.max(0, usage.apiUnlocks.limit - usage.apiUnlocks.used));
      if (credits === 0) cutshort.unlockFailed = "No Cutshort unlock credits are left in this billing cycle, so contact details were not fetched.";
      const best = credits > 0 ? await listCutshortUnlockCandidates(batch.jobId, env.ENRICHMENT_MIN_SCORE, credits) : [];
      for (const candidate of best) {
        try {
          const contact = await cutshort.client.candidate(candidate.cutshortId); // sequential on purpose
          const phone = extractIndianMobile(contact.phone) ?? (contact.phone && contact.phone.replace(/\D/g, "").length >= 10 ? contact.phone.replace(/[^\d+]/g, "") : null);
          await saveCutshortContact(candidate.candidateId, { name: contact.displayName, email: contact.email, phone });
        } catch (error) {
          if (error instanceof CutshortError && error.isUnlockLimit) {
            cutshort.unlockFailed = "Cutshort unlock credits are used up for this cycle, so some top candidates have no contact details yet.";
            break;
          }
          throw error;
        }
      }
      log.info({ credits, unlocked: best.length }, "cutshort unlocks done");
    } catch (error) {
      cutshort.unlockFailed ||= `Cutshort contact details could not be fetched: ${error instanceof Error ? error.message.slice(0, 160) : "unknown error"}`;
      log.warn({ err: error instanceof Error ? error.message : String(error) }, "cutshort unlock failed");
    }
  }

  // ---- 3. finish ----
  const total = scheduledMatchIds.size;
  if (total > 0 && scoring.failed === total) {
    // Every call failed: almost certainly a setup or outage problem, not bad candidates.
    // The candidates stay visible in the dashboard and can be scored again with "Retry failed".
    throw new Error(`All ${total} evaluations failed. First error: ${scoring.firstError}`);
  }

  // The note is shown to the recruiter, so it only ever reports a PROBLEM. Statistics go to the log.
  const notes: string[] = [];
  if (scoring.quick > 0) {
    notes.push(`${scoring.quick} of ${total} candidates got a Quick score (offline keyword match) because the AI was unavailable: ${scoring.quickReason}`);
  }
  if (review.tried > 0 && review.done < review.tried) {
    notes.push(`The AI could not review ${review.tried - review.done} of the top ${review.tried} candidates, so they keep their automatic score.`);
  }
  notes.push(...sourceNotes);
  if (cutshort.unlockFailed) notes.push(cutshort.unlockFailed);
  if (scrapeLinkedIn) log.info({ ...tiers, review, cutshortFound: cutshort.found }, "linkedin run statistics");
  const note = notes.length > 0 ? notes.join(" ") : undefined;
  await completeBatch(batch.id, note);
  log.info({ scored: total - scoring.failed, quick: scoring.quick, failed: scoring.failed }, "batch completed");
}

/** A short readable summary for the card: the start of the resume text, without contact data. */
function summaryOf(hit: CutshortHit): string | null {
  const text = buildCutshortProfileText(hit)
    .split("\n")
    .find((line) => line.startsWith("Bio: "))
    ?.slice(5);
  return text ? text.slice(0, 500) : null;
}

/** Embeds candidates (from the given ids) that have no embedding yet. Returns how many were saved. Never throws. */
async function embedMissing(candidateIds: string[], log: Logger): Promise<number> {
  try {
    const missing = await findCandidatesMissingEmbedding(candidateIds);
    let saved = 0;

    for (let start = 0; start < missing.length; start += EMBED_CHUNK_SIZE) {
      const chunk = missing.slice(start, start + EMBED_CHUNK_SIZE);
      const vectors = await embedTexts(chunk.map((candidate) => candidate.profileText));

      for (const [index, candidate] of chunk.entries()) {
        const vector = vectors[index];
        if (vector) {
          await saveCandidateEmbedding(candidate.id, vector);
          saved += 1;
        }
      }
    }
    return saved;
  } catch (error) {
    log.warn({ err: error }, "embedding failed, continuing without embeddings");
    return 0;
  }
}
