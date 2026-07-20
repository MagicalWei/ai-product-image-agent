const cacheKey = (sessionId) => `agent_conversation_cache:${sessionId}`;

const messageKey = (message = {}) => message.type === 'product_analysis'
  ? 'structured|product_analysis'
  : [
  message.sender || '',
  message.type || 'text',
  message.text || '',
].join('|');

const mergeMessageMetadata = (serverMessage, localMessage) => {
  const merged = {
    ...localMessage,
    ...serverMessage,
    ...(Array.isArray(serverMessage?.images) && serverMessage.images.length > 0
      ? { images: serverMessage.images }
      : Array.isArray(localMessage?.images) && localMessage.images.length > 0
        ? { images: localMessage.images }
        : {}),
    ...(serverMessage?.data ? { data: serverMessage.data } : localMessage?.data ? { data: localMessage.data } : {}),
  };
  const stableId = serverMessage?.id || localMessage?.id;
  if (stableId) merged.id = stableId;
  else delete merged.id;
  return merged;
};

const isStatusMessage = (message = {}) => (
  message.type === 'agent_status'
  || /^(?:🔧|正在(?:执行|生成|优化|准备|分析|查询|搜索|更新|检查))/.test(String(message.text || '').trim())
);

/**
 * Older builds did not persist tool/status events. Their cache merge appended
 * those unmatched records to the end of the conversation. A consecutive pair
 * of durable user turns is the reliable trace left by that bug: the first turn
 * had a visible status but no durable assistant record. Re-anchor one orphaned
 * status in each such gap, preserving the rest of the timeline.
 */
export function repairLegacyConversationOrder(messages = []) {
  const repaired = (Array.isArray(messages) ? messages : []).map(message => ({ ...message }));
  let searchFrom = 0;

  while (searchFrom < repaired.length - 1) {
    const firstUser = repaired.findIndex((message, index) => index >= searchFrom && message?.sender === 'user');
    if (firstUser < 0) break;
    let nextMeaningful = firstUser + 1;
    while (nextMeaningful < repaired.length && repaired[nextMeaningful]?.type === 'product_analysis') {
      nextMeaningful += 1;
    }
    if (repaired[nextMeaningful]?.sender !== 'user') {
      searchFrom = firstUser + 1;
      continue;
    }

    const orphanIndex = repaired.findIndex((message, index) => (
      index > nextMeaningful && isStatusMessage(message)
    ));
    if (orphanIndex < 0) {
      searchFrom = nextMeaningful;
      continue;
    }

    const [orphan] = repaired.splice(orphanIndex, 1);
    repaired.splice(nextMeaningful, 0, orphan);
    searchFrom = nextMeaningful + 2;
  }

  return repaired;
}

export function toDurableConversationHistory(messages = []) {
  return (Array.isArray(messages) ? messages : [])
    .filter(message => message?.type !== 'product_analysis' && String(message?.text || '').trim())
    .map(message => ({
      ...(message.id ? { id: String(message.id).slice(0, 160) } : {}),
      role: message.sender === 'user' ? 'user' : isStatusMessage(message) ? 'status' : 'assistant',
      content: String(message.text).trim(),
      ...(message.agent ? { agent: String(message.agent).slice(0, 80) } : {}),
      ...(isStatusMessage(message) ? { type: 'agent_status' } : message.type ? { type: String(message.type).slice(0, 80) } : {}),
      ...(message.sender === 'user' && Array.isArray(message.images) && message.images.length > 0
        ? { images: message.images }
        : {}),
    }));
}

export function loadConversationCache(sessionId) {
  if (!sessionId) return [];
  try {
    const value = JSON.parse(localStorage.getItem(cacheKey(sessionId)) || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export function saveConversationCache(sessionId, messages) {
  if (!sessionId || !Array.isArray(messages)) return;
  try {
    localStorage.setItem(cacheKey(sessionId), JSON.stringify(messages));
  } catch (error) {
    console.warn('Failed to cache conversation:', error);
  }
}

export function removeConversationCache(sessionId) {
  if (!sessionId) return;
  try {
    localStorage.removeItem(cacheKey(sessionId));
  } catch (error) {
    console.warn('Failed to remove conversation cache:', error);
  }
}

/** Merge without removing either local in-flight turns or durable server turns. */
export function mergeConversationMessages(serverMessages = [], localMessages = []) {
  const server = Array.isArray(serverMessages) ? serverMessages : [];
  const local = Array.isArray(localMessages) ? localMessages : [];
  if (local.length === 0) return server.map(message => ({ ...message }));
  if (server.length === 0) return local.map(message => ({ ...message }));

  // If both sides contain a structured card, its local position is the only
  // exact UI chronology available. Remove the server copy before sequence
  // merge and let the matching local card remain in place.
  const localStructuredKeys = new Set(
    local.filter(message => message?.type === 'product_analysis').map(messageKey),
  );
  const durable = server.filter(message => !localStructuredKeys.has(messageKey(message)));
  const rows = local.length + 1;
  const cols = durable.length + 1;
  const lcs = Array.from({ length: rows }, () => new Uint16Array(cols));
  for (let left = local.length - 1; left >= 0; left -= 1) {
    for (let right = durable.length - 1; right >= 0; right -= 1) {
      lcs[left][right] = messageKey(local[left]) === messageKey(durable[right])
        ? lcs[left + 1][right + 1] + 1
        : Math.max(lcs[left + 1][right], lcs[left][right + 1]);
    }
  }

  const merged = [];
  let left = 0;
  let right = 0;
  while (left < local.length && right < durable.length) {
    if (messageKey(local[left]) === messageKey(durable[right])) {
      merged.push(mergeMessageMetadata(durable[right], local[left]));
      left += 1;
      right += 1;
    } else if (lcs[left + 1][right] >= lcs[left][right + 1]) {
      // Local cache includes user-visible status/cards omitted from older
      // server histories; keep their exact position between durable turns.
      merged.push({ ...local[left] });
      left += 1;
    } else {
      merged.push({ ...durable[right] });
      right += 1;
    }
  }
  while (left < local.length) merged.push({ ...local[left++] });
  while (right < durable.length) merged.push({ ...durable[right++] });
  return repairLegacyConversationOrder(merged);
}
