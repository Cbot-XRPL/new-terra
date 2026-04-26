-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "acknowledgedAt" TIMESTAMP(3),
ADD COLUMN     "acknowledgedIp" TEXT,
ADD COLUMN     "acknowledgedName" TEXT,
ADD COLUMN     "milestoneLabel" TEXT,
ADD COLUMN     "requiresAcknowledgment" BOOLEAN NOT NULL DEFAULT false;
