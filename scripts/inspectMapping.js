import { PrismaClient } from "@prisma/client";
import { __test__ as qsTestHelpers } from "../src/agent/qsRundgang/QsRundgangAgent.js";

const prisma = new PrismaClient();

try {
  const templates = await prisma.bereichKapitelTextTemplate.findMany({
    include: {
      kapitelTemplate: {
        include: {
          bauteilTemplate: true,
        },
      },
    },
  });

  const mapped = templates.map((record) => {
    const bauteilTemplate = record?.kapitelTemplate?.bauteilTemplate;
    const kapitelTemplate = record?.kapitelTemplate;
    const text = record.text ?? "";

    return {
      ...record,
      text,
      textLower: text.toLowerCase(),
      bauteilTemplateId: bauteilTemplate?.id ?? null,
      bauteilName: bauteilTemplate?.name ?? null,
      bauteilNameLower: bauteilTemplate?.name?.toLowerCase() ?? "",
      kapitelName: kapitelTemplate?.name ?? null,
      kapitelNameLower: kapitelTemplate?.name?.toLowerCase() ?? "",
    };
  });

  const decision = qsTestHelpers.determineMatchOutcome("Strangabsperrventile ohne Entleerung", mapped);

  console.log(JSON.stringify(decision, null, 2));
} finally {
  await prisma.$disconnect();
}
