-- AlterTable
ALTER TABLE "ProjectImage" ADD COLUMN     "phase" TEXT,
ADD COLUMN     "takenAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "ProjectImage_projectId_takenAt_idx" ON "ProjectImage"("projectId", "takenAt");
