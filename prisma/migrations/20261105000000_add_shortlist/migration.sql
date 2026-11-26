-- Phase 4/5: shortlist flag on matches, and how many candidates a run sends to Gemini.
ALTER TABLE "ingestion_batches" ADD COLUMN "evaluationTotal" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "match_scores" ADD COLUMN "shortlisted" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "match_scores_jobId_shortlisted_idx" ON "match_scores"("jobId", "shortlisted");
