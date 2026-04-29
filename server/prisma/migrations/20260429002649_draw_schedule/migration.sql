-- CreateEnum
CREATE TYPE "DrawStatus" AS ENUM ('PENDING', 'READY', 'INVOICED', 'PAID', 'VOID');

-- CreateTable
CREATE TABLE "Draw" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "projectId" TEXT,
    "order" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "amountCents" INTEGER NOT NULL,
    "percentBasis" DOUBLE PRECISION,
    "status" "DrawStatus" NOT NULL DEFAULT 'PENDING',
    "invoiceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Draw_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Draw_invoiceId_key" ON "Draw"("invoiceId");

-- CreateIndex
CREATE INDEX "Draw_contractId_order_idx" ON "Draw"("contractId", "order");

-- CreateIndex
CREATE INDEX "Draw_projectId_idx" ON "Draw"("projectId");

-- CreateIndex
CREATE INDEX "Draw_status_idx" ON "Draw"("status");

-- AddForeignKey
ALTER TABLE "Draw" ADD CONSTRAINT "Draw_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Draw" ADD CONSTRAINT "Draw_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Draw" ADD CONSTRAINT "Draw_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
