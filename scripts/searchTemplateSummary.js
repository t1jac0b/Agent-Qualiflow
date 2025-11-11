import { PrismaClient } from "@prisma/client";

const term = process.argv[2];

if (!term) {
  console.error("Bitte Suchbegriff angeben.");
  process.exit(1);
}

const prisma = new PrismaClient();

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

  for (const item of matches) {
    const snippet = item.text.length > 160 ? `${item.text.slice(0, 160)}…` : item.text;
    console.log(
      JSON.stringify(
        {
          id: item.id,
          bauteil: item.kapitelTemplate?.bauteilTemplate?.name ?? null,
          kapitel: item.kapitelTemplate?.name ?? null,
          textSnippet: snippet,
        },
        null,
        2,
      ),
    );
  }
} finally {
  await prisma.$disconnect();
}
