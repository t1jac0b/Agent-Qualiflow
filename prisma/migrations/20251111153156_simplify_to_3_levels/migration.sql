/*
  Warnings:

  - You are about to drop the column `bereichId` on the `BereichKapitel` table. All the data in the column will be lost.
  - You are about to drop the column `bereichId` on the `Foto` table. All the data in the column will be lost.
  - You are about to drop the column `bereichId` on the `Position` table. All the data in the column will be lost.
  - You are about to drop the `Bereich` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `bauteilId` to the `BereichKapitel` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "public"."Bereich" DROP CONSTRAINT "Bereich_bauteilId_fkey";

-- DropForeignKey
ALTER TABLE "public"."BereichKapitel" DROP CONSTRAINT "BereichKapitel_bereichId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Foto" DROP CONSTRAINT "Foto_bereichId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Position" DROP CONSTRAINT "Position_bereichId_fkey";

-- AlterTable: add new column nullable first
ALTER TABLE "BereichKapitel"
ADD COLUMN     "bauteilId" INTEGER;

-- Backfill bauteilId from existing Bereich reference
UPDATE "BereichKapitel" bk
SET "bauteilId" = b."bauteilId"
FROM "public"."Bereich" b
WHERE bk."bereichId" = b."id" AND bk."bauteilId" IS NULL;

-- Make column required
ALTER TABLE "BereichKapitel"
ALTER COLUMN "bauteilId" SET NOT NULL;

-- Drop old reference column after backfill
ALTER TABLE "BereichKapitel" DROP COLUMN "bereichId";

-- AlterTable
ALTER TABLE "Foto" DROP COLUMN "bereichId";

-- AlterTable
ALTER TABLE "Position" DROP COLUMN "bereichId",
ADD COLUMN     "bereichKapitelId" INTEGER;

-- DropTable
DROP TABLE "public"."Bereich";

-- AddForeignKey
ALTER TABLE "BereichKapitel" ADD CONSTRAINT "BereichKapitel_bauteilId_fkey" FOREIGN KEY ("bauteilId") REFERENCES "Bauteil"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_bereichKapitelId_fkey" FOREIGN KEY ("bereichKapitelId") REFERENCES "BereichKapitel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
