export function appendConversationTurns(history, userMessage, assistantMessages) {
  const next = Array.isArray(history) ? [...history] : [];
  const cleanUserMessage = String(userMessage || '').trim();
  if (cleanUserMessage) {
    const last = next[next.length - 1];
    if (last?.role !== 'user' || last.content !== cleanUserMessage) {
      next.push({ role: 'user', content: cleanUserMessage });
    }
  }
  for (const rawMessage of assistantMessages || []) {
    const content = String(rawMessage || '').trim();
    if (!content) continue;
    const last = next[next.length - 1];
    if (last?.role !== 'assistant' || last.content !== content) {
      next.push({ role: 'assistant', content });
    }
  }
  return next;
}

export function mergeConversationHistory(existingHistory, incomingHistory) {
  const existing = Array.isArray(existingHistory) ? existingHistory : [];
  const incoming = Array.isArray(incomingHistory) ? incomingHistory : [];
  if (incoming.length === 0) return [...existing];
  if (existing.length === 0) return [...incoming];

  const sameTurn = (left, right) => left?.role === right?.role && left?.content === right?.content;
  const maxOverlap = Math.min(existing.length, incoming.length);
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    const existingStart = existing.length - overlap;
    let matches = true;
    for (let index = 0; index < overlap; index += 1) {
      if (!sameTurn(existing[existingStart + index], incoming[index])) {
        matches = false;
        break;
      }
    }
    if (matches) return [...existing, ...incoming.slice(overlap)];
  }
  return [...existing, ...incoming];
}

export function recoverConversationHistory(history, agentMemory) {
  if (Array.isArray(history) && history.length > 0) return history;
  const recentChat = agentMemory?.recent_chat;
  if (!Array.isArray(recentChat)) return [];
  return recentChat
    .filter((turn) => ['user', 'assistant'].includes(turn?.role) && String(turn?.content || '').trim())
    .map((turn) => ({ role: turn.role, content: String(turn.content).trim() }))
    .slice(-6);
}
