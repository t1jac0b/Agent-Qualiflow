-- CreateTable
CREATE TABLE "ReportRequest" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rawInputText" TEXT,
    "filePaths" TEXT[],
    "draftReport" TEXT,
    "isApproved" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ReportRequest_pkey" PRIMARY KEY ("id")
);
