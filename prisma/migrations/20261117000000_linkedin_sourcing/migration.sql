-- LinkedIn sourcing (Bright Data): candidates no longer need a GitHub id, and carry contact data.
ALTER TABLE "candidates" ALTER COLUMN "githubId" DROP NOT NULL;
ALTER TABLE "candidates"
  ADD COLUMN "source" TEXT NOT NULL DEFAULT 'github',
  ADD COLUMN "linkedinId" TEXT,
  ADD COLUMN "headline" TEXT,
  ADD COLUMN "skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "experienceYears" DOUBLE PRECISION,
  ADD COLUMN "emails" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "phoneNumbers" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "personalWebsite" TEXT,
  ADD COLUMN "otherLinks" TEXT[] DEFAULT ARRAY[]::TEXT[];
CREATE UNIQUE INDEX "candidates_linkedinId_key" ON "candidates"("linkedinId");

ALTER TABLE "ingestion_batches"
  ADD COLUMN "source" TEXT NOT NULL DEFAULT 'github',
  ADD COLUMN "linkedinUrls" TEXT[] DEFAULT ARRAY[]::TEXT[];
