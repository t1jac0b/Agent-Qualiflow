const sessions = new Map();

export function getSession(chatId) {
  if (!chatId) return null;
  return sessions.get(chatId) ?? null;
}

export function upsertSession(chatId, state) {
  if (!chatId) return;
  sessions.set(chatId, { ...state, updatedAt: new Date().toISOString() });
}

export function clearSession(chatId) {
  if (!chatId) return;
  sessions.delete(chatId);
}

export function pruneSessions({ maxAgeMinutes = 60 } = {}) {
  const now = Date.now();
  const threshold = maxAgeMinutes * 60 * 1000;
  for (const [chatId, state] of sessions.entries()) {
    const updatedAt = Date.parse(state.updatedAt ?? 0);
    if (Number.isNaN(updatedAt)) continue;
    if (now - updatedAt > threshold) {
      sessions.delete(chatId);
    }
  }
}
