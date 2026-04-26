-- CreateTable
CREATE TABLE "SubcontractorBillAttachment" (
    "id" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "thumbnailUrl" TEXT,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubcontractorBillAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SubcontractorBillAttachment_billId_idx" ON "SubcontractorBillAttachment"("billId");

-- AddForeignKey
ALTER TABLE "SubcontractorBillAttachment" ADD CONSTRAINT "SubcontractorBillAttachment_billId_fkey" FOREIGN KEY ("billId") REFERENCES "SubcontractorBill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubcontractorBillAttachment" ADD CONSTRAINT "SubcontractorBillAttachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
