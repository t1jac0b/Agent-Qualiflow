-- CreateTable
CREATE TABLE "BereichTemplate" (
    "id" SERIAL NOT NULL,
    "bauteilTemplateId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "reihenfolge" INTEGER,
    "aktiv" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "BereichTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BereichKapitelTemplate" (
    "id" SERIAL NOT NULL,
    "bereichTemplateId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "reihenfolge" INTEGER,

    CONSTRAINT "BereichKapitelTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BereichKapitelTextTemplate" (
    "id" SERIAL NOT NULL,
    "bereichKapitelTemplateId" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "reihenfolge" INTEGER,

    CONSTRAINT "BereichKapitelTextTemplate_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "BereichTemplate" ADD CONSTRAINT "BereichTemplate_bauteilTemplateId_fkey" FOREIGN KEY ("bauteilTemplateId") REFERENCES "BauteilTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BereichKapitelTemplate" ADD CONSTRAINT "BereichKapitelTemplate_bereichTemplateId_fkey" FOREIGN KEY ("bereichTemplateId") REFERENCES "BereichTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BereichKapitelTextTemplate" ADD CONSTRAINT "BereichKapitelTextTemplate_bereichKapitelTemplateId_fkey" FOREIGN KEY ("bereichKapitelTemplateId") REFERENCES "BereichKapitelTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
