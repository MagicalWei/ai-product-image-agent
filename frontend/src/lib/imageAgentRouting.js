export const DIRECT_IMAGE_AGENT_MARKER = '[[DIRECT_IMAGE_AGENT]]';
export const DIRECT_IMAGE_AGENT_REGION_MARKER = '[[DIRECT_IMAGE_AGENT_REGION]]';

/** Hide internal routing/context markers from user-facing conversation bubbles. */
export const stripAttachmentRoutingFromDisplay = (message = '') => {
  const withoutMarker = String(message)
    .replace(/^\[\[DIRECT_IMAGE_AGENT(?:_REGION)?\]\]\s*/u, '');
  const userInstruction = withoutMarker.match(/\[用户指令\]\s*([\s\S]*)$/u);
  return (userInstruction?.[1] || withoutMarker).trim();
};

/** Mark composer-image turns for transient direct routing in the Agent service. */
export const routeMessageForAttachments = (message, attachments = []) => {
  if (!attachments.length) return message;
  if (attachments.some(attachment => attachment.role === 'style_reference')) {
    return message;
  }
  const hasRegionAttachment = attachments.some(attachment => attachment.kind === 'region_edit');
  const marker = hasRegionAttachment
    ? DIRECT_IMAGE_AGENT_REGION_MARKER
    : DIRECT_IMAGE_AGENT_MARKER;
  return `${marker}\n${message}`;
};

/** Keep the confirmed product identity separate from newly attached context. */
export const resolveAttachmentImageRoles = ({
  attachments = [],
  encodedImages = [],
  establishedProductImage = null,
} = {}) => {
  const styleReferenceIndexes = attachments
    .map((image, index) => image.role === 'style_reference' ? index : -1)
    .filter(index => index >= 0);
  const styleReferenceImages = styleReferenceIndexes
    .map(index => encodedImages[index])
    .filter(Boolean);
  const untypedEntries = encodedImages
    .map((image, index) => ({ image, index }))
    .filter(({ image, index }) => image && !styleReferenceIndexes.includes(index));
  const fallbackProduct = untypedEntries[0]?.image || null;
  const productImage = establishedProductImage || fallbackProduct;
  const referenceImages = untypedEntries
    .filter(({ image }) => image !== productImage)
    .map(({ image }) => image);

  return { productImage, referenceImages, styleReferenceImages };
};
