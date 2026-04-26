-- CreateEnum
CREATE TYPE "SubcontractorBillStatus" AS ENUM ('PENDING', 'APPROVED', 'PAID', 'VOID');

-- CreateTable
CREATE TABLE "SubcontractorBill" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "externalNumber" TEXT,
    "subcontractorId" TEXT NOT NULL,
    "projectId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "status" "SubcontractorBillStatus" NOT NULL DEFAULT 'PENDING',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "paidAt" TIMESTAMP(3),
    "paidMethod" "PaymentMethod",
    "paidReference" TEXT,
    "notes" TEXT,
    "expenseId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubcontractorBill_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SubcontractorBill_number_key" ON "SubcontractorBill"("number");

-- CreateIndex
CREATE UNIQUE INDEX "SubcontractorBill_expenseId_key" ON "SubcontractorBill"("expenseId");

-- CreateIndex
CREATE INDEX "SubcontractorBill_subcontractorId_idx" ON "SubcontractorBill"("subcontractorId");

-- CreateIndex
CREATE INDEX "SubcontractorBill_projectId_idx" ON "SubcontractorBill"("projectId");

-- CreateIndex
CREATE INDEX "SubcontractorBill_status_idx" ON "SubcontractorBill"("status");

-- AddForeignKey
ALTER TABLE "SubcontractorBill" ADD CONSTRAINT "SubcontractorBill_subcontractorId_fkey" FOREIGN KEY ("subcontractorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubcontractorBill" ADD CONSTRAINT "SubcontractorBill_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubcontractorBill" ADD CONSTRAINT "SubcontractorBill_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubcontractorBill" ADD CONSTRAINT "SubcontractorBill_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE SET NULL ON UPDATE CASCADE;
