export const isReferenceCanvasImage = (element) => (
  element?.type === 'image'
  && element.source !== 'ai_generated'
  && !element.isGenerated
);

