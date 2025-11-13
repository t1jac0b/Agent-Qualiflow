-- AlterTable
ALTER TABLE "Position" ADD COLUMN     "reminderAt" TIMESTAMP(3),
ADD COLUMN     "reminderChannel" TEXT DEFAULT 'email',
ADD COLUMN     "reminderCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "reminderSentAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "PositionReminder" (
    "id" SERIAL NOT NULL,
    "positionId" INTEGER NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'email',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PositionReminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PositionReminder_scheduledFor_status_idx" ON "PositionReminder"("scheduledFor", "status");

-- CreateIndex
CREATE INDEX "PositionReminder_positionId_status_idx" ON "PositionReminder"("positionId", "status");

-- AddForeignKey
ALTER TABLE "PositionReminder" ADD CONSTRAINT "PositionReminder_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
