function inferImageType(asset = {}) {
  const explicit = asset.metrics?.image_type || asset.metrics?.imageType;
  if (explicit) return explicit;
  const name = String(asset.name || '').toLowerCase();
  if (name.includes('selling_point')) return 'selling_point';
  if (name.includes('detail')) return 'detail';
  if (name.includes('main')) return 'main';
  return 'generated';
}

function isRecoverableCanvasAsset(asset = {}) {
  if (!asset.url) return false;
  if (asset.source === 'ai_generated') return true;
  if (asset.source !== 'user_uploaded') return false;
  const role = asset.metrics?.asset_role || asset.metrics?.assetRole || 'product';
  return !['style_reference', 'chat_attachment'].includes(role);
}

/**
 * Reconcile durable AI assets into a session canvas. The assets table is the
 * recovery source when the browser disconnects before its canvas PUT arrives.
 */
export function recoverCanvasFromAssets(canvasState, assets = []) {
  const state = canvasState && typeof canvasState === 'object'
    ? structuredClone(canvasState)
    : {};
  const elements = Array.isArray(state.elements) ? state.elements : [];
  const knownUrls = new Set(elements.map(element => element?.url).filter(Boolean));
  let maxBottom = elements.reduce((max, element) => {
    const y = Number(element?.y) || 0;
    const height = Number(element?.height) || 0;
    return Math.max(max, y + height);
  }, 0);
  let recoveredCount = 0;

  for (const asset of assets) {
    if (!isRecoverableCanvasAsset(asset) || knownUrls.has(asset.url)) continue;
    const isGenerated = asset.source === 'ai_generated';
    const imageType = isGenerated ? inferImageType(asset) : 'product';
    const isDetail = imageType === 'detail';
    const width = isDetail ? 768 : isGenerated ? 800 : 600;
    const height = isDetail ? 1024 : isGenerated ? 800 : 600;
    const y = elements.length === 0 ? -height / 2 : maxBottom + 100;
    elements.push({
      id: `recovered-${asset.id}`,
      type: 'image',
      x: -width / 2,
      y,
      width,
      height,
      url: asset.url,
      name: asset.name || (isGenerated ? `AI ${imageType}` : '商品图'),
      source: asset.source,
      isGenerated,
      imageType,
    });
    knownUrls.add(asset.url);
    maxBottom = y + height;
    recoveredCount += 1;
  }

  return {
    canvasState: {
      ...state,
      elements,
      camera: state.camera || { x: 400, y: 300, zoom: 1 },
    },
    recoveredCount,
  };
}
