function imageMimeType(url = '') {
  const pathname = String(url).split('?')[0].toLowerCase();
  if (pathname.endsWith('.jpg') || pathname.endsWith('.jpeg')) return 'image/jpeg';
  if (pathname.endsWith('.webp')) return 'image/webp';
  if (pathname.endsWith('.gif')) return 'image/gif';
  return 'image/png';
}

export function selectStyleReferenceUrls(agentMemory = {}, messageImages = []) {
  const currentUrls = (Array.isArray(messageImages) ? messageImages : [])
    .filter((image) => image?.role === 'style_reference' && typeof image.url === 'string')
    .map((image) => image.url.trim())
    .filter((url) => url && !url.startsWith('data:'));

  if (currentUrls.length > 0) {
    return [...new Set(currentUrls)].slice(0, 3);
  }

  const storedUrls = Array.isArray(agentMemory?.style_reference_image_urls)
    ? agentMemory.style_reference_image_urls
    : [];
  return [...new Set(storedUrls.filter((url) => typeof url === 'string' && url.trim()))]
    .slice(0, 3);
}

export async function restoreStyleReferenceImages(storage, urls = []) {
  const uniqueUrls = [...new Set((Array.isArray(urls) ? urls : []).filter(Boolean))].slice(0, 3);
  const restored = await Promise.all(uniqueUrls.map(async (url) => {
    if (String(url).startsWith('data:image/')) return url;
    try {
      const imageBuffer = await storage.getFileBuffer(url);
      return `data:${imageMimeType(url)};base64,${imageBuffer.toString('base64')}`;
    } catch (error) {
      console.warn(`[Agent] Unable to restore style reference ${url}: ${error.message}`);
      return '';
    }
  }));
  return restored.filter(Boolean);
}
