-- Project: public-portfolio fields
ALTER TABLE "Project"
  ADD COLUMN "showOnPortfolio" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "portfolioSlug" TEXT,
  ADD COLUMN "serviceCategory" TEXT,
  ADD COLUMN "heroImageId" TEXT,
  ADD COLUMN "publicSummary" TEXT;

CREATE UNIQUE INDEX "Project_portfolioSlug_key" ON "Project"("portfolioSlug");

-- SatisfactionSurvey: public-testimonial approval fields
ALTER TABLE "SatisfactionSurvey"
  ADD COLUMN "publicApprovedAt" TIMESTAMP(3),
  ADD COLUMN "publicQuote" TEXT,
  ADD COLUMN "publicAttribution" TEXT;

CREATE INDEX "SatisfactionSurvey_publicApprovedAt_idx" ON "SatisfactionSurvey"("publicApprovedAt");
