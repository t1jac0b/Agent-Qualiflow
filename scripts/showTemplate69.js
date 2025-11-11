import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

try {
  const template = await prisma.bereichKapitelTextTemplate.findUnique({
    where: { id: 69 },
    include: {
      kapitelTemplate: {
        include: {
          bauteilTemplate: true,
        },
      },
    },
  });

  console.log(JSON.stringify(template, null, 2));
} finally {
  await prisma.$disconnect();
}
