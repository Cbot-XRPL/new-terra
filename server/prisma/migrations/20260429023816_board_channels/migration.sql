-- 1. Channel table.
CREATE TABLE "Channel" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Channel_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Channel_name_key" ON "Channel"("name");
CREATE INDEX "Channel_archivedAt_position_idx" ON "Channel"("archivedAt", "position");

-- 2. Seed a default 'general' channel so the not-null FK on existing posts
--    has a target. The fixed id keeps backfill deterministic.
INSERT INTO "Channel" ("id", "name", "description", "position", "createdAt", "updatedAt")
VALUES (
    'channel-default-general',
    'general',
    'Company-wide announcements and chatter.',
    0,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
);

-- 3. Add channelId to MessageBoardPost as nullable, backfill, then enforce.
ALTER TABLE "MessageBoardPost" ADD COLUMN "channelId" TEXT;
UPDATE "MessageBoardPost" SET "channelId" = 'channel-default-general' WHERE "channelId" IS NULL;
ALTER TABLE "MessageBoardPost" ALTER COLUMN "channelId" SET NOT NULL;

CREATE INDEX "MessageBoardPost_channelId_createdAt_idx" ON "MessageBoardPost"("channelId", "createdAt");

-- 4. FKs.
ALTER TABLE "MessageBoardPost" ADD CONSTRAINT "MessageBoardPost_channelId_fkey"
    FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Channel" ADD CONSTRAINT "Channel_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
