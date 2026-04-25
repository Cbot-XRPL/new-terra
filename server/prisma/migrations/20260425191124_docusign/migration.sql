-- CreateEnum
CREATE TYPE "ContractDelivery" AS ENUM ('PORTAL', 'DOCUSIGN');

-- AlterTable
ALTER TABLE "Contract" ADD COLUMN     "delivery" "ContractDelivery" NOT NULL DEFAULT 'PORTAL',
ADD COLUMN     "docusignEnvelopeId" TEXT,
ADD COLUMN     "docusignStatus" TEXT;
