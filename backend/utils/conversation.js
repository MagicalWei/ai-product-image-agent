export function appendConversationTurns(history, userMessage, assistantMessages, userMetadata = {}) {
  const next = Array.isArray(history) ? [...history] : [];
  const cleanUserMessage = String(userMessage || '').trim();
  if (cleanUserMessage) {
    const last = next[next.length - 1];
    if (last?.role !== 'user' || last.content !== cleanUserMessage) {
      next.push({ role: 'user', content: cleanUserMessage, ...userMetadata });
    } else if (Object.keys(userMetadata).length > 0) {
      next[next.length - 1] = { ...last, ...userMetadata };
    }
  }
  for (const rawMessage of assistantMessages || []) {
    const record = rawMessage && typeof rawMessage === 'object' ? rawMessage : null;
    const content = String(record?.content ?? rawMessage ?? '').trim();
    if (!content) continue;
    const role = record?.role === 'status' ? 'status' : 'assistant';
    const metadata = record ? {
      ...(record.agent ? { agent: String(record.agent).slice(0, 80) } : {}),
      ...(record.type ? { type: String(record.type).slice(0, 80) } : {}),
    } : {};
    const last = next[next.length - 1];
    if (last?.role !== role || last.content !== content) {
      next.push({ role, content, ...metadata });
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
  const rows = existing.length + 1;
  const cols = incoming.length + 1;
  const lcs = Array.from({ length: rows }, () => new Uint16Array(cols));
  for (let left = existing.length - 1; left >= 0; left -= 1) {
    for (let right = incoming.length - 1; right >= 0; right -= 1) {
      lcs[left][right] = sameTurn(existing[left], incoming[right])
        ? lcs[left + 1][right + 1] + 1
        : Math.max(lcs[left + 1][right], lcs[left][right + 1]);
    }
  }

  const merged = [];
  let left = 0;
  let right = 0;
  while (left < existing.length && right < incoming.length) {
    if (sameTurn(existing[left], incoming[right])) {
      merged.push({ ...incoming[right], ...existing[left] });
      left += 1;
      right += 1;
    } else if (lcs[left + 1][right] >= lcs[left][right + 1]) {
      // Existing durable UI records own their established timeline position,
      // including status events that are intentionally absent from model chat.
      merged.push({ ...existing[left] });
      left += 1;
    } else {
      merged.push({ ...incoming[right] });
      right += 1;
    }
  }
  while (left < existing.length) merged.push({ ...existing[left++] });
  while (right < incoming.length) merged.push({ ...incoming[right++] });
  return merged;
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

/**
 * The durable UI history may include attachment metadata. Model endpoints use
 * a strict List[Dict[str, str]] contract, so only role/content cross that
 * boundary while the richer record remains stored for conversation restore.
 */
export function toModelConversationHistory(history) {
  return (Array.isArray(history) ? history : [])
    .filter(turn => ['user', 'assistant', 'system'].includes(turn?.role))
    .map(turn => ({
      role: String(turn.role),
      content: String(turn.content || ''),
    }))
    .filter(turn => turn.content.trim());
}
