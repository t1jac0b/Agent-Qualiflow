import { PrismaClient } from "@prisma/client";

const idArg = process.argv[2];
if (!idArg) {
  console.error("Bitte Template-ID angeben.");
  process.exit(1);
}

const id = Number.parseInt(idArg, 10);
if (Number.isNaN(id)) {
  console.error("Ungültige ID:", idArg);
  process.exit(1);
}

const prisma = new PrismaClient();

try {
  const template = await prisma.bereichKapitelTextTemplate.findUnique({
    where: { id },
    include: {
      kapitelTemplate: {
        include: {
          bauteilTemplate: true,
        },
      },
    },
  });

  if (!template) {
    console.log(`Kein Template mit ID ${id} gefunden.`);
    process.exit(0);
  }

  console.log(JSON.stringify(template, null, 2));
} finally {
  await prisma.$disconnect();
}
