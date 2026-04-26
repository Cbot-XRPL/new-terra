-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "archivedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ProjectComment" ADD COLUMN     "attachments" JSONB;
