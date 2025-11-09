const TIMESTAMP = () => new Date().toISOString();

function normalizeMeta(meta) {
  if (!meta) return {};
  if (meta instanceof Error) {
    return { error: { message: meta.message, stack: meta.stack } };
  }

  const normalized = { ...meta };

  if (meta.error instanceof Error) {
    normalized.error = {
      message: meta.error.message,
      stack: meta.error.stack,
    };
  }

  return normalized;
}

function emit({ level, message, scope, meta }) {
  const payload = {
    timestamp: TIMESTAMP(),
    level,
    scope,
    message,
    ...normalizeMeta(meta),
  };

  const serialized = JSON.stringify(payload);

  switch (level) {
    case "error":
      console.error(serialized);
      break;
    case "warn":
      console.warn(serialized);
      break;
    default:
      console.log(serialized);
  }
}

export function createLogger(scope = "app") {
  return {
    info(message, meta) {
      emit({ level: "info", message, scope, meta });
    },
    warn(message, meta) {
      emit({ level: "warn", message, scope, meta });
    },
    error(message, meta) {
      emit({ level: "error", message, scope, meta });
    },
  };
}

export const logger = createLogger();
