-- Existing campaign mappings remain valid historical records. New v2 mappings
-- can freeze the exact merchant-provided campaign evidence without storing it in
-- shopper URLs or telemetry.
ALTER TABLE "CampaignMapping" ADD COLUMN "campaignEvidenceRef" TEXT;
ALTER TABLE "CampaignMapping" ADD COLUMN "campaignEvidenceHash" TEXT;
ALTER TABLE "CampaignMapping" ADD COLUMN "campaignLocale" TEXT NOT NULL DEFAULT 'en';
