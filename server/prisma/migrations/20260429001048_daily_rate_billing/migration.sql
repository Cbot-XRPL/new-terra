-- CreateEnum
CREATE TYPE "BillingMode" AS ENUM ('HOURLY', 'DAILY');

-- AlterTable
ALTER TABLE "TimeEntry" ADD COLUMN     "dailyRateCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "dayUnits" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "billingMode" "BillingMode" NOT NULL DEFAULT 'HOURLY',
ADD COLUMN     "dailyRateCents" INTEGER NOT NULL DEFAULT 0;
