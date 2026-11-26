-- Apify X-Ray sourcing: a candidate is identified by its LinkedIn URL; the phone is optional and no email is required.
ALTER TABLE "candidates"
  ADD COLUMN "phone" TEXT,
  ADD COLUMN "phoneSource" TEXT;
