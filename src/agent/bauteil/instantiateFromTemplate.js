const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const HOOK_FLAG = Symbol.for('agent.qualiflow.bauteilInstantiationHook');

function ensurePrismaClient(prisma) {
  if (!prisma || typeof prisma.$transaction !== 'function') {
    throw new Error('instantiateBauteilFromTemplate: prisma client is required.');
  }
}

function toInt(value, label) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`instantiateBauteilFromTemplate: ${label} must be a number.`);
  }
  return parsed;
}

function resolveOrder(templateOrder, index) {
  return typeof templateOrder === 'number' ? templateOrder : index + 1;
}

function sanitizeTemplateNode(node) {
  return isPlainObject(node) ? node : {};
}

export async function instantiateBauteilFromTemplate(prisma, bauteilId, options = {}) {
  ensurePrismaClient(prisma);
  const id = toInt(bauteilId, 'bauteilId');
  const { force = false } = options;

  return prisma.$transaction(async (tx) => {
    const bauteil = await tx.bauteil.findUnique({
      where: { id },
      include: {
        template: {
          include: {
            bereichTemplates: {
              include: {
                kapitel: {
                  include: { texte: true },
                  orderBy: { reihenfolge: 'asc' },
                },
              },
              orderBy: { reihenfolge: 'asc' },
            },
          },
        },
        bereiche: { select: { id: true } },
      },
    });

    if (!bauteil) {
      throw new Error(`instantiateBauteilFromTemplate: Bauteil ${id} not found.`);
    }

    if (!bauteil.template) {
      throw new Error(`instantiateBauteilFromTemplate: Bauteil ${id} has no template.`);
    }

    if (!force && bauteil.bereiche.length > 0) {
      return {
        status: 'skipped',
        reason: 'already_has_bereiche',
        bauteilId: id,
        created: { bereiche: 0, kapitel: 0, texte: 0 },
      };
    }

    if (force) {
      await tx.bereichKapitelText.deleteMany({ where: { kapitel: { bereich: { bauteilId: id } } } });
      await tx.bereichKapitel.deleteMany({ where: { bereich: { bauteilId: id } } });
      await tx.bereich.deleteMany({ where: { bauteilId: id } });
    }

    const counts = { bereiche: 0, kapitel: 0, texte: 0 };
    const { bereichTemplates = [] } = sanitizeTemplateNode(bauteil.template);

    for (const [bereichIndex, rawBereichTemplate] of bereichTemplates.entries()) {
      const bereichTemplate = sanitizeTemplateNode(rawBereichTemplate);
      const bereichRecord = await tx.bereich.create({
        data: {
          bauteilId: id,
          name: bereichTemplate.name ?? `Bereich ${bereichIndex + 1}`,
          bereichstext: null,
        },
      });

      counts.bereiche += 1;

      const kapitelTemplates = Array.isArray(bereichTemplate.kapitel) ? bereichTemplate.kapitel : [];

      for (const [kapitelIndex, rawKapitelTemplate] of kapitelTemplates.entries()) {
        const kapitelTemplate = sanitizeTemplateNode(rawKapitelTemplate);
        const kapitelRecord = await tx.bereichKapitel.create({
          data: {
            bereichId: bereichRecord.id,
            name: kapitelTemplate.name ?? `Kapitel ${kapitelIndex + 1}`,
            reihenfolge: resolveOrder(kapitelTemplate.reihenfolge, kapitelIndex),
          },
        });

        counts.kapitel += 1;

        const textTemplates = Array.isArray(kapitelTemplate.texte) ? kapitelTemplate.texte : [];

        for (const [textIndex, rawTextTemplate] of textTemplates.entries()) {
          const textTemplate = sanitizeTemplateNode(rawTextTemplate);
          await tx.bereichKapitelText.create({
            data: {
              bereichKapitelId: kapitelRecord.id,
              text: textTemplate.text ?? '',
              reihenfolge: resolveOrder(textTemplate.reihenfolge, textIndex),
            },
          });

          counts.texte += 1;
        }
      }
    }

    return { status: 'created', bauteilId: id, created: counts };
  });
}

export async function instantiateBauteile(prisma, bauteilIds, options = {}) {
  ensurePrismaClient(prisma);
  const ids = Array.isArray(bauteilIds) ? bauteilIds : [];
  const results = [];

  for (const rawId of ids) {
    const id = toInt(rawId, 'bauteilId');
    const result = await instantiateBauteilFromTemplate(prisma, id, options);
    results.push(result);
  }

  return results;
}

export function summarizeInstantiation(results = []) {
  return results.reduce(
    (acc, entry) => {
      if (entry?.status === 'created') {
        acc.created += 1;
        acc.bereiche += entry.created?.bereiche ?? 0;
        acc.kapitel += entry.created?.kapitel ?? 0;
        acc.texte += entry.created?.texte ?? 0;
      } else if (entry?.status === 'skipped') {
        acc.skipped += 1;
      }
      return acc;
    },
    { created: 0, skipped: 0, bereiche: 0, kapitel: 0, texte: 0 }
  );
}

export function attachBauteilInstantiationHook(prisma, options = {}) {
  ensurePrismaClient(prisma);
  if (prisma[HOOK_FLAG]) {
    return;
  }

  const {
    force = false,
    throwOnError = false,
    logger = console,
  } = options;

  if (typeof prisma.$use !== 'function') {
    if (logger && typeof logger.warn === 'function') {
      logger.warn('Prisma middleware API ($use) not available; skipping Bauteil instantiation hook.');
    } else {
      console.warn('Prisma middleware API ($use) not available; skipping Bauteil instantiation hook.');
    }
    prisma[HOOK_FLAG] = true;
    return;
  }

  prisma.$use(async (params, next) => {
    const result = await next(params);

    if (params.model !== 'Bauteil' || params.action !== 'create') {
      return result;
    }

    const bauteilId = result?.id;
    if (!bauteilId) {
      return result;
    }

    const templateId =
      result?.bauteilTemplateId ??
      params.args?.data?.bauteilTemplateId ??
      params.args?.data?.template?.connect?.id ??
      null;

    if (!templateId) {
      return result;
    }

    try {
      await instantiateBauteilFromTemplate(prisma, bauteilId, { force });
    } catch (error) {
      if (throwOnError) {
        throw error;
      }
      if (logger && typeof logger.warn === 'function') {
        logger.warn(`Bauteil instantiation hook failed for ${bauteilId}:`, error);
      } else {
        console.warn(`Bauteil instantiation hook failed for ${bauteilId}:`, error);
      }
    }

    return result;
  });

  prisma[HOOK_FLAG] = true;
}
