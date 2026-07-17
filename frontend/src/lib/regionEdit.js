const loadImageElement = (source) => new Promise((resolve, reject) => {
  const image = new Image();
  if (/^https?:\/\//.test(source)) image.crossOrigin = 'anonymous';
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error('无法读取框选的原图'));
  image.src = source;
});

export const loadImageForComposition = async (source) => {
  try {
    return await loadImageElement(source);
  } catch (directError) {
    if (!source || source.startsWith('data:image/') || source.startsWith('blob:')) {
      throw directError;
    }
    const response = await fetch('/api/assets/image-data', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: source }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.data_url) {
      throw new Error(result.error || result.message || '无法从云端读取框选原图');
    }
    return loadImageElement(result.data_url);
  }
};

/** Compose the source image and visual edit frames at original resolution. */
export const composeImageWithRegions = async (targetImage, regions, sourceUrl = targetImage.url) => {
  const image = await loadImageForComposition(sourceUrl);
  const outputWidth = image.naturalWidth || targetImage.width;
  const outputHeight = image.naturalHeight || targetImage.height;
  const canvas = document.createElement('canvas');
  canvas.width = outputWidth;
  canvas.height = outputHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('当前浏览器无法创建图片合成画布');
  ctx.drawImage(image, 0, 0, outputWidth, outputHeight);

  const scaleX = outputWidth / targetImage.width;
  const scaleY = outputHeight / targetImage.height;
  regions.forEach(region => {
    const x = region.relX * scaleX;
    const y = region.relY * scaleY;
    const width = region.width * scaleX;
    const height = region.height * scaleY;
    const color = region.color || '#EF4444';
    ctx.fillStyle = `${color}1A`;
    ctx.fillRect(x, y, width, height);
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(4, Math.round(Math.min(scaleX, scaleY) * 3));
    ctx.strokeRect(x, y, width, height);
  });

  return canvas.toDataURL('image/png');
};

/** Link and clip a drawn rectangle to the frontmost image under its center. */
export const createImageEditRegion = (rectangle, elements) => {
  if (!rectangle || rectangle.type !== 'rect') return null;
  const centerX = rectangle.x + rectangle.width / 2;
  const centerY = rectangle.y + rectangle.height / 2;
  const targetImage = [...elements].reverse().find(element =>
    element.type === 'image' &&
    centerX >= element.x && centerX <= element.x + element.width &&
    centerY >= element.y && centerY <= element.y + element.height
  );
  if (!targetImage) return null;

  const x = Math.max(rectangle.x, targetImage.x);
  const y = Math.max(rectangle.y, targetImage.y);
  const maxX = Math.min(rectangle.x + rectangle.width, targetImage.x + targetImage.width);
  const maxY = Math.min(rectangle.y + rectangle.height, targetImage.y + targetImage.height);
  const width = Math.max(0, maxX - x);
  const height = Math.max(0, maxY - y);
  if (width <= 4 || height <= 4) return null;

  return {
    targetImage,
    region: {
      ...rectangle,
      x,
      y,
      width,
      height,
      imageId: targetImage.id,
      relX: x - targetImage.x,
      relY: y - targetImage.y,
      isEditRegion: true,
    },
  };
};
