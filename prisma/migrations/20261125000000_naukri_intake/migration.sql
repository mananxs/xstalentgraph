-- Naukri intake: candidates shortlisted in the browser extension land here, with their resume stored in the platform.
ALTER TABLE "candidates" ADD COLUMN "naukriId" TEXT;
ALTER TABLE "candidates" ADD COLUMN "ctc" TEXT;
ALTER TABLE "candidates" ADD COLUMN "noticePeriod" TEXT;
ALTER TABLE "candidates" ADD COLUMN "resumeFileName" TEXT;
ALTER TABLE "candidates" ADD COLUMN "resumeFileType" TEXT;
ALTER TABLE "candidates" ADD COLUMN "resumeData" BYTEA;
ALTER TABLE "candidates" ADD COLUMN "resumeText" TEXT;
ALTER TABLE "candidates" ADD COLUMN "resumeCapturedAt" TIMESTAMPTZ(3);
CREATE UNIQUE INDEX "candidates_naukriId_key" ON "candidates"("naukriId");
ALTER TABLE "match_scores" ADD COLUMN "note" TEXT;
