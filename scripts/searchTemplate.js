import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const term = process.argv[2] ?? "";

if (!term) {
  console.error("Bitte Suchbegriff angeben.");
  process.exit(1);
}

try {
  const matches = await prisma.bereichKapitelTextTemplate.findMany({
    where: {
      text: {
        contains: term,
        mode: "insensitive",
      },
    },
    include: {
      kapitelTemplate: {
        include: {
          bauteilTemplate: true,
        },
      },
    },
    take: limit,
  });

  for (const entry of matches) {
    console.log(JSON.stringify({
      id: entry.id,
      bauteil: entry.kapitelTemplate?.bauteilTemplate?.name ?? null,
      kapitel: entry.kapitelTemplate?.name ?? null,
      text: entry.text,
    }));
  }
} finally {
  await prisma.$disconnect();
}
