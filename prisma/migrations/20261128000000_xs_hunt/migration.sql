-- AlterTable
ALTER TABLE "candidates" ADD COLUMN     "organizationId" UUID,
ADD COLUMN     "primarySource" TEXT NOT NULL DEFAULT 'github',
ADD COLUMN     "sources" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "match_scores" ADD COLUMN     "latestEvaluationId" UUID,
ADD COLUMN     "overrideAt" TIMESTAMPTZ(3),
ADD COLUMN     "overrideById" UUID,
ADD COLUMN     "overrideReason" TEXT,
ADD COLUMN     "overrideScore" INTEGER,
ADD COLUMN     "overrideTier" TEXT,
ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "rubricVersion" INTEGER,
ADD COLUMN     "stage" TEXT NOT NULL DEFAULT 'new',
ADD COLUMN     "stageChangedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "tier" TEXT;

-- AlterTable
ALTER TABLE "recruiters" ADD COLUMN     "role" TEXT NOT NULL DEFAULT 'recruiter';

-- CreateTable
CREATE TABLE "candidate_sources" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" UUID NOT NULL,
    "candidateId" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "profileUrl" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "firstSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "candidate_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidate_resumes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" UUID NOT NULL,
    "candidateId" UUID NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "text" TEXT,
    "origin" TEXT NOT NULL DEFAULT 'naukri',
    "capturedById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "candidate_resumes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evaluation_rubrics" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "jobId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "dimensions" JSONB NOT NULL,
    "custom" JSONB NOT NULL DEFAULT '[]',
    "notes" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evaluation_rubrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidate_evaluations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "candidateId" UUID NOT NULL,
    "rubricId" UUID NOT NULL,
    "rubricVersion" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "tier" TEXT NOT NULL,
    "evidenceCoverage" DOUBLE PRECISION NOT NULL,
    "dimensions" JSONB NOT NULL,
    "strengths" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "concerns" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "missingInfo" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "engine" TEXT NOT NULL DEFAULT 'xs-hunt-standard',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "candidate_evaluations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" UUID NOT NULL,
    "jobId" UUID,
    "candidateId" UUID,
    "matchId" UUID,
    "kind" TEXT NOT NULL,
    "fromStage" TEXT,
    "toStage" TEXT,
    "actorId" UUID,
    "data" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pipeline_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidate_notes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "matchId" UUID NOT NULL,
    "authorId" UUID,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "candidate_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interviews" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "matchId" UUID NOT NULL,
    "scheduledAt" TIMESTAMPTZ(3) NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'video',
    "interviewers" TEXT,
    "outcome" TEXT,
    "notes" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "interviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reminders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "matchId" UUID NOT NULL,
    "dueAt" TIMESTAMPTZ(3) NOT NULL,
    "text" TEXT NOT NULL,
    "doneAt" TIMESTAMPTZ(3),
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reminders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extension_connections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" UUID NOT NULL,
    "recruiterId" UUID NOT NULL,
    "deviceId" TEXT NOT NULL,
    "version" TEXT,
    "naukriState" TEXT NOT NULL DEFAULT 'unknown',
    "naukriCheckedAt" TIMESTAMPTZ(3),
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "extension_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sourcing_tasks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "sourcingState" TEXT NOT NULL DEFAULT 'idle',
    "aiState" TEXT NOT NULL DEFAULT 'idle',
    "filters" JSONB NOT NULL DEFAULT '{}',
    "filterReport" JSONB NOT NULL DEFAULT '{}',
    "filtersAppliedAt" TIMESTAMPTZ(3),
    "rubricVersion" INTEGER,
    "limits" JSONB NOT NULL DEFAULT '{}',
    "pagesDone" INTEGER NOT NULL DEFAULT 0,
    "capturedCount" INTEGER NOT NULL DEFAULT 0,
    "duplicateCount" INTEGER NOT NULL DEFAULT 0,
    "analyzedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "connectionId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(3),

    CONSTRAINT "sourcing_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sourcing_commands" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "taskId" UUID NOT NULL,
    "messageId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "result" JSONB,
    "ackedAt" TIMESTAMPTZ(3),
    "doneAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sourcing_commands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "taskId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "captured_candidates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" UUID NOT NULL,
    "taskId" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "cardKey" TEXT NOT NULL,
    "page" INTEGER NOT NULL DEFAULT 1,
    "position" INTEGER NOT NULL DEFAULT 0,
    "rawText" TEXT NOT NULL,
    "parsed" JSONB NOT NULL DEFAULT '{}',
    "profileUrl" TEXT,
    "candidateId" UUID,
    "aiStatus" TEXT NOT NULL DEFAULT 'pending',
    "aiError" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "capturedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "analyzedAt" TIMESTAMPTZ(3),

    CONSTRAINT "captured_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retrieval_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "candidateId" UUID NOT NULL,
    "taskId" UUID,
    "approvedById" UUID NOT NULL,
    "approvedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creditAck" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reason" TEXT,
    "result" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "retrieval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "candidate_sources_candidateId_idx" ON "candidate_sources"("candidateId");

-- CreateIndex
CREATE UNIQUE INDEX "candidate_sources_organizationId_source_externalId_key" ON "candidate_sources"("organizationId", "source", "externalId");

-- CreateIndex
CREATE INDEX "candidate_resumes_organizationId_candidateId_idx" ON "candidate_resumes"("organizationId", "candidateId");

-- CreateIndex
CREATE UNIQUE INDEX "candidate_resumes_candidateId_sha256_key" ON "candidate_resumes"("candidateId", "sha256");

-- CreateIndex
CREATE UNIQUE INDEX "evaluation_rubrics_jobId_version_key" ON "evaluation_rubrics"("jobId", "version");

-- CreateIndex
CREATE INDEX "candidate_evaluations_jobId_candidateId_createdAt_idx" ON "candidate_evaluations"("jobId", "candidateId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "candidate_evaluations_organizationId_jobId_tier_idx" ON "candidate_evaluations"("organizationId", "jobId", "tier");

-- CreateIndex
CREATE INDEX "pipeline_events_organizationId_createdAt_idx" ON "pipeline_events"("organizationId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "pipeline_events_matchId_createdAt_idx" ON "pipeline_events"("matchId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "pipeline_events_jobId_kind_idx" ON "pipeline_events"("jobId", "kind");

-- CreateIndex
CREATE INDEX "candidate_notes_matchId_createdAt_idx" ON "candidate_notes"("matchId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "interviews_matchId_scheduledAt_idx" ON "interviews"("matchId", "scheduledAt");

-- CreateIndex
CREATE INDEX "reminders_matchId_dueAt_idx" ON "reminders"("matchId", "dueAt");

-- CreateIndex
CREATE INDEX "extension_connections_organizationId_lastSeenAt_idx" ON "extension_connections"("organizationId", "lastSeenAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "extension_connections_recruiterId_deviceId_key" ON "extension_connections"("recruiterId", "deviceId");

-- CreateIndex
CREATE INDEX "sourcing_tasks_organizationId_jobId_createdAt_idx" ON "sourcing_tasks"("organizationId", "jobId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "sourcing_commands_messageId_key" ON "sourcing_commands"("messageId");

-- CreateIndex
CREATE INDEX "sourcing_commands_taskId_status_createdAt_idx" ON "sourcing_commands"("taskId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "task_events_taskId_createdAt_idx" ON "task_events"("taskId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "captured_candidates_taskId_aiStatus_idx" ON "captured_candidates"("taskId", "aiStatus");

-- CreateIndex
CREATE INDEX "captured_candidates_jobId_aiStatus_idx" ON "captured_candidates"("jobId", "aiStatus");

-- CreateIndex
CREATE UNIQUE INDEX "captured_candidates_taskId_cardKey_key" ON "captured_candidates"("taskId", "cardKey");

-- CreateIndex
CREATE INDEX "retrieval_requests_organizationId_status_idx" ON "retrieval_requests"("organizationId", "status");

-- CreateIndex
CREATE INDEX "retrieval_requests_candidateId_idx" ON "retrieval_requests"("candidateId");

-- CreateIndex
CREATE INDEX "candidates_organizationId_primarySource_idx" ON "candidates"("organizationId", "primarySource");

-- CreateIndex
CREATE INDEX "match_scores_jobId_stage_idx" ON "match_scores"("jobId", "stage");

-- AddForeignKey
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_sources" ADD CONSTRAINT "candidate_sources_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_sources" ADD CONSTRAINT "candidate_sources_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_resumes" ADD CONSTRAINT "candidate_resumes_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_resumes" ADD CONSTRAINT "candidate_resumes_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluation_rubrics" ADD CONSTRAINT "evaluation_rubrics_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "job_descriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_evaluations" ADD CONSTRAINT "candidate_evaluations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_evaluations" ADD CONSTRAINT "candidate_evaluations_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "job_descriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_evaluations" ADD CONSTRAINT "candidate_evaluations_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_evaluations" ADD CONSTRAINT "candidate_evaluations_rubricId_fkey" FOREIGN KEY ("rubricId") REFERENCES "evaluation_rubrics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_events" ADD CONSTRAINT "pipeline_events_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_events" ADD CONSTRAINT "pipeline_events_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_notes" ADD CONSTRAINT "candidate_notes_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "match_scores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "match_scores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "match_scores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extension_connections" ADD CONSTRAINT "extension_connections_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extension_connections" ADD CONSTRAINT "extension_connections_recruiterId_fkey" FOREIGN KEY ("recruiterId") REFERENCES "recruiters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sourcing_tasks" ADD CONSTRAINT "sourcing_tasks_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sourcing_tasks" ADD CONSTRAINT "sourcing_tasks_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "job_descriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sourcing_commands" ADD CONSTRAINT "sourcing_commands_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "sourcing_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_events" ADD CONSTRAINT "task_events_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "sourcing_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "captured_candidates" ADD CONSTRAINT "captured_candidates_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "captured_candidates" ADD CONSTRAINT "captured_candidates_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "sourcing_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "captured_candidates" ADD CONSTRAINT "captured_candidates_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "candidates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retrieval_requests" ADD CONSTRAINT "retrieval_requests_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retrieval_requests" ADD CONSTRAINT "retrieval_requests_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ============================================================================
-- Data backfill (safe to run on a database that already holds data)
-- ============================================================================

-- "Naukri AI" is an evaluation engine, never a source: normalise any such source to plain "naukri".
UPDATE "candidates" SET "source" = 'naukri' WHERE lower("source") LIKE 'naukri%';
UPDATE "candidates" SET "primarySource" = "source", "sources" = ARRAY["source"];

-- Privately captured candidates belong to the one organization whose jobs reference them.
UPDATE "candidates" c SET "organizationId" = x.org
FROM (
  SELECT ms."candidateId" AS cid, (array_agg(DISTINCT j."organizationId"))[1] AS org, count(DISTINCT j."organizationId") AS n
  FROM "match_scores" ms JOIN "job_descriptions" j ON j."id" = ms."jobId"
  GROUP BY ms."candidateId"
) x
WHERE x.cid = c."id" AND x.n = 1;

-- Naukri keys become organization-scoped so two organizations can never share a person row.
UPDATE "candidates" SET "naukriId" = left("organizationId"::text, 8) || ':' || "naukriId"
WHERE "naukriId" IS NOT NULL AND "organizationId" IS NOT NULL AND "naukriId" NOT LIKE '%:%';

-- One source record per existing candidate.
INSERT INTO "candidate_sources" ("organizationId", "candidateId", "source", "externalId", "profileUrl")
SELECT c."organizationId", c."id", c."primarySource",
       COALESCE(c."naukriId", c."linkedinId", c."cutshortId", c."githubId"::text, c."login"), c."profileUrl"
FROM "candidates" c WHERE c."organizationId" IS NOT NULL
ON CONFLICT DO NOTHING;

-- Existing resumes move into the resume table (the legacy columns stay for older readers).
INSERT INTO "candidate_resumes" ("organizationId", "candidateId", "fileName", "fileType", "sizeBytes", "sha256", "data", "text", "origin")
SELECT c."organizationId", c."id", COALESCE(c."resumeFileName", 'resume.' || COALESCE(c."resumeFileType", 'pdf')), COALESCE(c."resumeFileType", 'pdf'),
       octet_length(c."resumeData"), encode(sha256(c."resumeData"), 'hex'), c."resumeData", c."resumeText", c."primarySource"
FROM "candidates" c WHERE c."organizationId" IS NOT NULL AND c."resumeData" IS NOT NULL
ON CONFLICT DO NOTHING;

-- Pipeline stage of existing matches.
UPDATE "match_scores" SET "stage" = CASE WHEN "shortlisted" THEN 'shortlisted' WHEN "status" = 'completed' THEN 'sourced' ELSE 'new' END,
  "stageChangedAt" = "updatedAt";

-- The first recruiter of every organization becomes its administrator.
UPDATE "recruiters" r SET "role" = 'admin'
WHERE r."id" = (SELECT r2."id" FROM "recruiters" r2 WHERE r2."organizationId" = r."organizationId" ORDER BY r2."createdAt", r2."id" LIMIT 1);
