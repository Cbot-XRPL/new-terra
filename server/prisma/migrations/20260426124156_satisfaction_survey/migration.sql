-- CreateTable
CREATE TABLE "SatisfactionSurvey" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "score" INTEGER,
    "comments" TEXT,
    "improvements" TEXT,
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SatisfactionSurvey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SatisfactionSurvey_projectId_key" ON "SatisfactionSurvey"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "SatisfactionSurvey_tokenHash_key" ON "SatisfactionSurvey"("tokenHash");

-- CreateIndex
CREATE INDEX "SatisfactionSurvey_sentAt_idx" ON "SatisfactionSurvey"("sentAt");

-- CreateIndex
CREATE INDEX "SatisfactionSurvey_submittedAt_idx" ON "SatisfactionSurvey"("submittedAt");

-- AddForeignKey
ALTER TABLE "SatisfactionSurvey" ADD CONSTRAINT "SatisfactionSurvey_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SatisfactionSurvey" ADD CONSTRAINT "SatisfactionSurvey_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
