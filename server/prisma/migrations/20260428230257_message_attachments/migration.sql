-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "attachments" JSONB;

-- AlterTable
ALTER TABLE "MessageBoardPost" ADD COLUMN     "attachments" JSONB;
