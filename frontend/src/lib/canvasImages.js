export const isReferenceCanvasImage = (element) => (
  element?.type === 'image'
);

/** All canvas images are reusable materials; collapse exact duplicate layers. */
export const getCanvasMaterialImages = (elements = []) => {
  const seen = new Set();
  return (Array.isArray(elements) ? elements : []).filter((element) => {
    if (!isReferenceCanvasImage(element)) return false;
    const key = element.url || element.id;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};
