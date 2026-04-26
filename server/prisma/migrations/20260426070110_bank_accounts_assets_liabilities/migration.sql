-- CreateEnum
CREATE TYPE "BankAccountKind" AS ENUM ('CHECKING', 'SAVINGS', 'CASH', 'CREDIT_CARD', 'LINE_OF_CREDIT', 'LOAN', 'OTHER');

-- CreateTable
CREATE TABLE "BankAccount" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "BankAccountKind" NOT NULL DEFAULT 'CHECKING',
    "last4" TEXT,
    "institutionName" TEXT,
    "currentBalanceCents" INTEGER NOT NULL DEFAULT 0,
    "isLiability" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankTransaction" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "runningBalanceCents" INTEGER,
    "categoryId" TEXT,
    "reconciled" BOOLEAN NOT NULL DEFAULT false,
    "reconciledAt" TIMESTAMP(3),
    "matchedPaymentId" TEXT,
    "matchedExpenseId" TEXT,
    "matchedSubBillId" TEXT,
    "externalId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankCategorizationRule" (
    "id" TEXT NOT NULL,
    "accountId" TEXT,
    "matchText" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "vendorId" TEXT,
    "projectId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankCategorizationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OtherAsset" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "currentValueCents" INTEGER NOT NULL DEFAULT 0,
    "acquiredAt" TIMESTAMP(3),
    "acquisitionCostCents" INTEGER,
    "notes" TEXT,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OtherAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OtherLiability" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "currentBalanceCents" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OtherLiability_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BankTransaction_accountId_date_idx" ON "BankTransaction"("accountId", "date");

-- CreateIndex
CREATE INDEX "BankTransaction_accountId_externalId_idx" ON "BankTransaction"("accountId", "externalId");

-- CreateIndex
CREATE INDEX "BankTransaction_categoryId_idx" ON "BankTransaction"("categoryId");

-- CreateIndex
CREATE INDEX "BankCategorizationRule_accountId_idx" ON "BankCategorizationRule"("accountId");

-- CreateIndex
CREATE INDEX "BankCategorizationRule_categoryId_idx" ON "BankCategorizationRule"("categoryId");

-- AddForeignKey
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "BankAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ExpenseCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_matchedPaymentId_fkey" FOREIGN KEY ("matchedPaymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_matchedExpenseId_fkey" FOREIGN KEY ("matchedExpenseId") REFERENCES "Expense"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_matchedSubBillId_fkey" FOREIGN KEY ("matchedSubBillId") REFERENCES "SubcontractorBill"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankCategorizationRule" ADD CONSTRAINT "BankCategorizationRule_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "BankAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankCategorizationRule" ADD CONSTRAINT "BankCategorizationRule_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ExpenseCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankCategorizationRule" ADD CONSTRAINT "BankCategorizationRule_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankCategorizationRule" ADD CONSTRAINT "BankCategorizationRule_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
