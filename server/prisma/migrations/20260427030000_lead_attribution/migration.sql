-- Lead attribution columns: where the lead came from on the marketing site.
ALTER TABLE "Lead"
  ADD COLUMN "serviceCategory" TEXT,
  ADD COLUMN "landingPath" TEXT,
  ADD COLUMN "referrer" TEXT,
  ADD COLUMN "utmSource" TEXT,
  ADD COLUMN "utmMedium" TEXT,
  ADD COLUMN "utmCampaign" TEXT;

CREATE INDEX "Lead_serviceCategory_idx" ON "Lead"("serviceCategory");
