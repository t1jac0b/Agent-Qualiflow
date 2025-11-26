-- CreateTable
CREATE TABLE "PositionRueckmeldungstyp" (
    "id" SERIAL NOT NULL,
    "positionId" INTEGER NOT NULL,
    "rueckmeldungstypId" INTEGER NOT NULL,

    CONSTRAINT "PositionRueckmeldungstyp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PositionRueckmeldungstyp_positionId_rueckmeldungstypId_key" ON "PositionRueckmeldungstyp"("positionId", "rueckmeldungstypId");

-- AddForeignKey
ALTER TABLE "PositionRueckmeldungstyp" ADD CONSTRAINT "PositionRueckmeldungstyp_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PositionRueckmeldungstyp" ADD CONSTRAINT "PositionRueckmeldungstyp_rueckmeldungstypId_fkey" FOREIGN KEY ("rueckmeldungstypId") REFERENCES "Rueckmeldungstyp"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
