-- The Naukri extension's backend now lives in TalentGraph: personal keys, search sessions, card/profile score cache.
ALTER TABLE "candidates" ADD COLUMN "fullProfile" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "api_keys" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "recruiterId" UUID NOT NULL,
  "keyHash" TEXT NOT NULL,
  "label" TEXT NOT NULL DEFAULT 'Naukri extension',
  "lastUsedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "api_keys_recruiterId_fkey" FOREIGN KEY ("recruiterId") REFERENCES "recruiters"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "api_keys_keyHash_key" ON "api_keys"("keyHash");
CREATE INDEX "api_keys_recruiterId_idx" ON "api_keys"("recruiterId");

CREATE TABLE "search_sessions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "jobId" UUID NOT NULL,
  "recruiterId" UUID NOT NULL,
  "signature" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "state" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "search_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "search_sessions_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "job_descriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "search_sessions_recruiterId_fkey" FOREIGN KEY ("recruiterId") REFERENCES "recruiters"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "search_sessions_jobId_recruiterId_signature_key" ON "search_sessions"("jobId", "recruiterId", "signature");

CREATE TABLE "card_scores" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "jobId" UUID NOT NULL,
  "recruiterId" UUID NOT NULL,
  "cardKey" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'card',
  "rubricHash" TEXT NOT NULL,
  "score" INTEGER NOT NULL,
  "displayName" TEXT,
  "profileUrl" TEXT,
  "result" JSONB NOT NULL,
  "sessionIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "card_scores_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "card_scores_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "job_descriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "card_scores_recruiterId_fkey" FOREIGN KEY ("recruiterId") REFERENCES "recruiters"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "card_scores_jobId_recruiterId_cardKey_kind_key" ON "card_scores"("jobId", "recruiterId", "cardKey", "kind");
CREATE INDEX "card_scores_jobId_recruiterId_rubricHash_idx" ON "card_scores"("jobId", "recruiterId", "rubricHash");
