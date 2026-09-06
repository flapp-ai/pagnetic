-- AlterTable
ALTER TABLE "CampaignMapping" ADD COLUMN     "campaignEvidenceHash" TEXT,
ADD COLUMN     "campaignEvidenceRef" TEXT,
ADD COLUMN     "campaignLocale" TEXT NOT NULL DEFAULT 'en';
