import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

try {
  const templates = await prisma.bereichKapitelTextTemplate.findMany({
    where: {
      kapitelTemplate: {
        bauteilTemplate: {
          name: { equals: "Sanitär", mode: "insensitive" },
        },
      },
    },
    include: {
      kapitelTemplate: {
        include: {
          bauteilTemplate: true,
        },
      },
    },
  });

  console.log(`Sanitär Templates: ${templates.length}`);
  for (const template of templates) {
    console.log(`\nID ${template.id}`);
    console.log(`Bauteil: ${template.kapitelTemplate?.bauteilTemplate?.name}`);
    console.log(`Kapitel: ${template.kapitelTemplate?.name}`);
    console.log(template.text);
  }
} finally {
  await prisma.$disconnect();
}
