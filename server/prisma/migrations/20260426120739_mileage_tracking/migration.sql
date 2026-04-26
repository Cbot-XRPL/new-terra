-- AlterTable
ALTER TABLE "CompanySettings" ADD COLUMN     "mileageRateCents" INTEGER NOT NULL DEFAULT 670;

-- CreateTable
CREATE TABLE "MileageEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "milesTenths" INTEGER NOT NULL,
    "rateCentsPerMile" INTEGER NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "purpose" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MileageEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MileageEntry_userId_date_idx" ON "MileageEntry"("userId", "date");

-- CreateIndex
CREATE INDEX "MileageEntry_projectId_idx" ON "MileageEntry"("projectId");

-- AddForeignKey
ALTER TABLE "MileageEntry" ADD CONSTRAINT "MileageEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MileageEntry" ADD CONSTRAINT "MileageEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
