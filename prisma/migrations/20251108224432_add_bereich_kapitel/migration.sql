-- CreateTable
CREATE TABLE "BereichKapitel" (
    "id" SERIAL NOT NULL,
    "bereichId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "reihenfolge" INTEGER,

    CONSTRAINT "BereichKapitel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BereichKapitelText" (
    "id" SERIAL NOT NULL,
    "bereichKapitelId" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "reihenfolge" INTEGER,

    CONSTRAINT "BereichKapitelText_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "BereichKapitel" ADD CONSTRAINT "BereichKapitel_bereichId_fkey" FOREIGN KEY ("bereichId") REFERENCES "Bereich"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BereichKapitelText" ADD CONSTRAINT "BereichKapitelText_bereichKapitelId_fkey" FOREIGN KEY ("bereichKapitelId") REFERENCES "BereichKapitel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
