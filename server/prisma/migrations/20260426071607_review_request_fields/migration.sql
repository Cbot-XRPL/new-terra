-- AlterTable
ALTER TABLE "CompanySettings" ADD COLUMN     "googleReviewUrl" TEXT,
ADD COLUMN     "yelpReviewUrl" TEXT;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "reviewRequestSentAt" TIMESTAMP(3);
