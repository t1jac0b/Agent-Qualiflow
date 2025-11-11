/*
  Entfernt die BereichTemplate-Hierarchie. Bestehende Daten werden vor dem Schema-Change gelöscht,
  der Katalog wird später neu importiert.
*/

-- vorhandene Bereich*-Daten löschen
DELETE FROM "public"."BereichKapitelTextTemplate";
DELETE FROM "public"."BereichKapitelTemplate";
DELETE FROM "public"."BereichTemplate";

-- DropForeignKey
ALTER TABLE "public"."BereichKapitelTemplate" DROP CONSTRAINT "BereichKapitelTemplate_bereichTemplateId_fkey";

-- DropForeignKey
ALTER TABLE "public"."BereichTemplate" DROP CONSTRAINT "BereichTemplate_bauteilTemplateId_fkey";

-- AlterTable
ALTER TABLE "public"."BereichKapitelTemplate" DROP COLUMN "bereichTemplateId",
ADD COLUMN     "bauteilTemplateId" INTEGER NOT NULL;

-- DropTable
DROP TABLE "public"."BereichTemplate";

-- AddForeignKey
ALTER TABLE "BereichKapitelTemplate" ADD CONSTRAINT "BereichKapitelTemplate_bauteilTemplateId_fkey" FOREIGN KEY ("bauteilTemplateId") REFERENCES "BauteilTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
