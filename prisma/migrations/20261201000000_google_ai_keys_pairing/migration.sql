-- AlterTable
ALTER TABLE "recruiters" ADD COLUMN     "googleSub" TEXT,
ADD COLUMN     "avatarUrl" TEXT,
ADD COLUMN     "lastLoginAt" TIMESTAMPTZ(3),
ADD COLUMN     "activeJobId" UUID,
ADD COLUMN     "activeJobAt" TIMESTAMPTZ(3);

-- CreateIndex
CREATE UNIQUE INDEX "recruiters_googleSub_key" ON "recruiters"("googleSub");

-- CreateTable
CREATE TABLE "ai_credentials" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "recruiterId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "encryptedKey" TEXT NOT NULL,
    "last4" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "coolingUntil" TIMESTAMPTZ(3),
    "lastError" TEXT,
    "lastUsedAt" TIMESTAMPTZ(3),
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pairing_codes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "recruiterId" UUID NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "usedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pairing_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_credentials_recruiterId_provider_key" ON "ai_credentials"("recruiterId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "pairing_codes_codeHash_key" ON "pairing_codes"("codeHash");

-- CreateIndex
CREATE INDEX "pairing_codes_recruiterId_createdAt_idx" ON "pairing_codes"("recruiterId", "createdAt");

-- AddForeignKey
ALTER TABLE "ai_credentials" ADD CONSTRAINT "ai_credentials_recruiterId_fkey" FOREIGN KEY ("recruiterId") REFERENCES "recruiters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pairing_codes" ADD CONSTRAINT "pairing_codes_recruiterId_fkey" FOREIGN KEY ("recruiterId") REFERENCES "recruiters"("id") ON DELETE CASCADE ON UPDATE CASCADE;
