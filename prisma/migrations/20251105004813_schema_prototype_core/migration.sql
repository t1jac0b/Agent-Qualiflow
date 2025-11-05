-- CreateTable
CREATE TABLE "Projektleiter" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "telefon" TEXT,
    "aktiv" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Projektleiter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Kontakt" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "aktiv" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Kontakt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Objekttyp" (
    "id" SERIAL NOT NULL,
    "bezeichnung" TEXT NOT NULL,
    "aktiv" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Objekttyp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Kunde" (
    "id" SERIAL NOT NULL,
    "kontaktId" INTEGER,
    "projektleiterId" INTEGER,
    "name" TEXT NOT NULL,
    "adresse" TEXT,
    "plz" TEXT,
    "ort" TEXT,
    "status" TEXT,
    "erstelldatum" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Kunde_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Verteiler" (
    "id" SERIAL NOT NULL,
    "kundeId" INTEGER NOT NULL,
    "kontaktId" INTEGER NOT NULL,

    CONSTRAINT "Verteiler_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Objekt" (
    "id" SERIAL NOT NULL,
    "kundeId" INTEGER NOT NULL,
    "kontaktId" INTEGER,
    "projektleiterId" INTEGER,
    "objekttypId" INTEGER,
    "bezeichnung" TEXT NOT NULL,
    "erstellungsjahr" INTEGER,
    "egid" INTEGER,
    "adresse" TEXT,
    "plz" TEXT,
    "ort" TEXT,
    "terminStartsitzung" TIMESTAMP(3),
    "protokollURL" TEXT,
    "status" BOOLEAN,
    "notiz" TEXT,
    "erstelltAm" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "titelbildURL" TEXT,

    CONSTRAINT "Objekt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BaurundgangTyp" (
    "id" SERIAL NOT NULL,
    "nummer" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "reihenfolge" INTEGER,
    "aktiv" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "BaurundgangTyp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Baurundgang" (
    "id" SERIAL NOT NULL,
    "objektId" INTEGER NOT NULL,
    "baurundgangTypId" INTEGER NOT NULL,
    "datumGeplant" TIMESTAMP(3),
    "datumDurchgefuehrt" TIMESTAMP(3),
    "status" TEXT,
    "notiz" TEXT,
    "erstelltAm" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Baurundgang_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pruefpunkt" (
    "id" SERIAL NOT NULL,
    "baurundgangId" INTEGER NOT NULL,
    "bezeichnung" TEXT NOT NULL,
    "erledigt" BOOLEAN NOT NULL DEFAULT false,
    "notiz" TEXT,
    "reihenfolge" INTEGER,

    CONSTRAINT "Pruefpunkt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BauteilTemplate" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "reihenfolge" INTEGER,
    "aktiv" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "BauteilTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialisierungTemplate" (
    "id" SERIAL NOT NULL,
    "bauteilTemplateId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "reihenfolge" INTEGER,
    "aktiv" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "MaterialisierungTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BauteilRisiko" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "reihenfolge" INTEGER,
    "aktiv" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "BauteilRisiko_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bauteil" (
    "id" SERIAL NOT NULL,
    "baurundgangId" INTEGER NOT NULL,
    "bauteilTemplateId" INTEGER,
    "materialisierungTemplateId" INTEGER,
    "bauteilRisikoId" INTEGER,
    "reihenfolge" INTEGER,

    CONSTRAINT "Bauteil_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bereich" (
    "id" SERIAL NOT NULL,
    "bauteilId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "bereichstext" TEXT,

    CONSTRAINT "Bereich_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Foto" (
    "id" SERIAL NOT NULL,
    "baurundgangId" INTEGER NOT NULL,
    "bereichId" INTEGER,
    "dateiURL" TEXT NOT NULL,
    "hinweisMarkierung" TEXT,
    "erstelltAm" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Foto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rueckmeldungstyp" (
    "id" SERIAL NOT NULL,
    "typCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Rueckmeldungstyp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QSReport" (
    "id" SERIAL NOT NULL,
    "baurundgangId" INTEGER NOT NULL,
    "objektId" INTEGER NOT NULL,
    "kundeId" INTEGER NOT NULL,
    "projektleiterId" INTEGER,
    "kontaktId" INTEGER,
    "objekttypId" INTEGER,
    "titelbildURL" TEXT,
    "zusammenfassung" TEXT,
    "diverses" TEXT,
    "erstelltAm" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QSReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QSReportTeilnehmer" (
    "id" SERIAL NOT NULL,
    "qsreportId" INTEGER NOT NULL,
    "kontaktId" INTEGER NOT NULL,

    CONSTRAINT "QSReportTeilnehmer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Position" (
    "id" SERIAL NOT NULL,
    "qsreportId" INTEGER NOT NULL,
    "bauteilId" INTEGER,
    "bereichId" INTEGER,
    "rueckmeldungstypId" INTEGER,
    "positionsnummer" INTEGER NOT NULL,
    "bereichstitel" TEXT,
    "bemerkung" TEXT,
    "loeschbar" BOOLEAN DEFAULT true,
    "frist" TIMESTAMP(3),
    "erledigtAm" TIMESTAMP(3),
    "erledigt" BOOLEAN DEFAULT false,
    "rueckmeldungBemerkung" TEXT,

    CONSTRAINT "Position_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PositionFoto" (
    "id" SERIAL NOT NULL,
    "positionId" INTEGER NOT NULL,
    "fotoId" INTEGER NOT NULL,

    CONSTRAINT "PositionFoto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Verteiler_kundeId_kontaktId_key" ON "Verteiler"("kundeId", "kontaktId");

-- CreateIndex
CREATE UNIQUE INDEX "QSReport_baurundgangId_key" ON "QSReport"("baurundgangId");

-- CreateIndex
CREATE INDEX "QSReport_objektId_idx" ON "QSReport"("objektId");

-- CreateIndex
CREATE INDEX "QSReport_kundeId_idx" ON "QSReport"("kundeId");

-- CreateIndex
CREATE UNIQUE INDEX "QSReportTeilnehmer_qsreportId_kontaktId_key" ON "QSReportTeilnehmer"("qsreportId", "kontaktId");

-- CreateIndex
CREATE UNIQUE INDEX "Position_qsreportId_positionsnummer_key" ON "Position"("qsreportId", "positionsnummer");

-- CreateIndex
CREATE UNIQUE INDEX "PositionFoto_positionId_fotoId_key" ON "PositionFoto"("positionId", "fotoId");

-- AddForeignKey
ALTER TABLE "Kunde" ADD CONSTRAINT "Kunde_kontaktId_fkey" FOREIGN KEY ("kontaktId") REFERENCES "Kontakt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Kunde" ADD CONSTRAINT "Kunde_projektleiterId_fkey" FOREIGN KEY ("projektleiterId") REFERENCES "Projektleiter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Verteiler" ADD CONSTRAINT "Verteiler_kundeId_fkey" FOREIGN KEY ("kundeId") REFERENCES "Kunde"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Verteiler" ADD CONSTRAINT "Verteiler_kontaktId_fkey" FOREIGN KEY ("kontaktId") REFERENCES "Kontakt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Objekt" ADD CONSTRAINT "Objekt_kundeId_fkey" FOREIGN KEY ("kundeId") REFERENCES "Kunde"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Objekt" ADD CONSTRAINT "Objekt_kontaktId_fkey" FOREIGN KEY ("kontaktId") REFERENCES "Kontakt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Objekt" ADD CONSTRAINT "Objekt_projektleiterId_fkey" FOREIGN KEY ("projektleiterId") REFERENCES "Projektleiter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Objekt" ADD CONSTRAINT "Objekt_objekttypId_fkey" FOREIGN KEY ("objekttypId") REFERENCES "Objekttyp"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Baurundgang" ADD CONSTRAINT "Baurundgang_objektId_fkey" FOREIGN KEY ("objektId") REFERENCES "Objekt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Baurundgang" ADD CONSTRAINT "Baurundgang_baurundgangTypId_fkey" FOREIGN KEY ("baurundgangTypId") REFERENCES "BaurundgangTyp"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pruefpunkt" ADD CONSTRAINT "Pruefpunkt_baurundgangId_fkey" FOREIGN KEY ("baurundgangId") REFERENCES "Baurundgang"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialisierungTemplate" ADD CONSTRAINT "MaterialisierungTemplate_bauteilTemplateId_fkey" FOREIGN KEY ("bauteilTemplateId") REFERENCES "BauteilTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bauteil" ADD CONSTRAINT "Bauteil_baurundgangId_fkey" FOREIGN KEY ("baurundgangId") REFERENCES "Baurundgang"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bauteil" ADD CONSTRAINT "Bauteil_bauteilTemplateId_fkey" FOREIGN KEY ("bauteilTemplateId") REFERENCES "BauteilTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bauteil" ADD CONSTRAINT "Bauteil_materialisierungTemplateId_fkey" FOREIGN KEY ("materialisierungTemplateId") REFERENCES "MaterialisierungTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bauteil" ADD CONSTRAINT "Bauteil_bauteilRisikoId_fkey" FOREIGN KEY ("bauteilRisikoId") REFERENCES "BauteilRisiko"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bereich" ADD CONSTRAINT "Bereich_bauteilId_fkey" FOREIGN KEY ("bauteilId") REFERENCES "Bauteil"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Foto" ADD CONSTRAINT "Foto_baurundgangId_fkey" FOREIGN KEY ("baurundgangId") REFERENCES "Baurundgang"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Foto" ADD CONSTRAINT "Foto_bereichId_fkey" FOREIGN KEY ("bereichId") REFERENCES "Bereich"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QSReport" ADD CONSTRAINT "QSReport_baurundgangId_fkey" FOREIGN KEY ("baurundgangId") REFERENCES "Baurundgang"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QSReport" ADD CONSTRAINT "QSReport_objektId_fkey" FOREIGN KEY ("objektId") REFERENCES "Objekt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QSReport" ADD CONSTRAINT "QSReport_kundeId_fkey" FOREIGN KEY ("kundeId") REFERENCES "Kunde"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QSReport" ADD CONSTRAINT "QSReport_projektleiterId_fkey" FOREIGN KEY ("projektleiterId") REFERENCES "Projektleiter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QSReport" ADD CONSTRAINT "QSReport_kontaktId_fkey" FOREIGN KEY ("kontaktId") REFERENCES "Kontakt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QSReport" ADD CONSTRAINT "QSReport_objekttypId_fkey" FOREIGN KEY ("objekttypId") REFERENCES "Objekttyp"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QSReportTeilnehmer" ADD CONSTRAINT "QSReportTeilnehmer_qsreportId_fkey" FOREIGN KEY ("qsreportId") REFERENCES "QSReport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QSReportTeilnehmer" ADD CONSTRAINT "QSReportTeilnehmer_kontaktId_fkey" FOREIGN KEY ("kontaktId") REFERENCES "Kontakt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_qsreportId_fkey" FOREIGN KEY ("qsreportId") REFERENCES "QSReport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_bauteilId_fkey" FOREIGN KEY ("bauteilId") REFERENCES "Bauteil"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_bereichId_fkey" FOREIGN KEY ("bereichId") REFERENCES "Bereich"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_rueckmeldungstypId_fkey" FOREIGN KEY ("rueckmeldungstypId") REFERENCES "Rueckmeldungstyp"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PositionFoto" ADD CONSTRAINT "PositionFoto_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PositionFoto" ADD CONSTRAINT "PositionFoto_fotoId_fkey" FOREIGN KEY ("fotoId") REFERENCES "Foto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
