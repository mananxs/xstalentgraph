-- Cutshort sourcing: candidates found through the Cutshort API are keyed by their talentCardId.
ALTER TABLE "candidates" ADD COLUMN "cutshortId" TEXT;
CREATE UNIQUE INDEX "candidates_cutshortId_key" ON "candidates"("cutshortId");
