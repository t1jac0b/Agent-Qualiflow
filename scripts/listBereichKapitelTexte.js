import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

try {
  const entries = await prisma.bereichKapitelTextTemplate.findMany({
    include: {
      kapitelTemplate: {
        include: {
          bauteilTemplate: true,
        },
      },
    },
    orderBy: [
      { kapitelTemplate: { bauteilTemplateId: "asc" } },
      { kapitelTemplate: { reihenfolge: "asc" } },
      { reihenfolge: "asc" },
      { id: "asc" },
    ],
  });

  console.log("Bauteil\tKapitel\tText");
  for (const entry of entries) {
    const bauteilName = entry.kapitelTemplate?.bauteilTemplate?.name ?? "";
    const kapitelName = entry.kapitelTemplate?.name ?? "";
    const text = entry.text ?? "";
    const cleanBauteil = bauteilName.replace(/\s+/g, " ").trim();
    const cleanKapitel = kapitelName.replace(/\s+/g, " ").trim();
    const cleanText = text.replace(/\s+/g, " ").trim();
    console.log(`${cleanBauteil}\t${cleanKapitel}\t${cleanText}`);
  }
} finally {
  await prisma.$disconnect();
}
