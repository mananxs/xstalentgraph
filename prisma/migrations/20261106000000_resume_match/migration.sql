-- AlterTable
ALTER TABLE "job_descriptions" ADD COLUMN     "employmentType" TEXT,
ADD COLUMN     "experienceYears" DOUBLE PRECISION,
ADD COLUMN     "handsOn" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "rawText" TEXT,
ADD COLUMN     "seniority" TEXT,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'manual',
ADD COLUMN     "sourceFileName" TEXT,
ADD COLUMN     "technologies" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "workMode" TEXT;

-- CreateTable
CREATE TABLE "resume_candidates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "uploadedById" UUID NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "fileData" BYTEA,
    "resumeText" TEXT NOT NULL,
    "name" TEXT,
    "summary" TEXT,
    "candidateYears" DOUBLE PRECISION,
    "requiredYears" DOUBLE PRECISION,
    "skills" JSONB NOT NULL DEFAULT '[]',
    "score" INTEGER NOT NULL DEFAULT 0,
    "reqHit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reqTotal" INTEGER NOT NULL DEFAULT 0,
    "scoredBy" TEXT NOT NULL,
    "shortlisted" BOOLEAN NOT NULL DEFAULT false,
    "maskStatus" TEXT NOT NULL DEFAULT 'none',
    "maskedText" TEXT,
    "maskError" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resume_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "resume_candidates_jobId_score_idx" ON "resume_candidates"("jobId", "score" DESC);

-- CreateIndex
CREATE INDEX "resume_candidates_organizationId_createdAt_idx" ON "resume_candidates"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "resume_candidates_jobId_shortlisted_idx" ON "resume_candidates"("jobId", "shortlisted");

-- CreateIndex
CREATE INDEX "resume_candidates_uploadedById_idx" ON "resume_candidates"("uploadedById");

-- AddForeignKey
ALTER TABLE "resume_candidates" ADD CONSTRAINT "resume_candidates_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resume_candidates" ADD CONSTRAINT "resume_candidates_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "job_descriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resume_candidates" ADD CONSTRAINT "resume_candidates_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "recruiters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

