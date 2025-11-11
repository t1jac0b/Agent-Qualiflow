import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

try {
  const matches = await prisma.bereichKapitelTextTemplate.findMany({
    where: {
      text: {
        contains: "Gemäss W3:2013",
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
  });

  console.log(JSON.stringify(matches, null, 2));
} finally {
  await prisma.$disconnect();
}
