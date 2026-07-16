export const DIRECT_IMAGE_AGENT_MARKER = '[[DIRECT_IMAGE_AGENT]]';
export const DIRECT_IMAGE_AGENT_REGION_MARKER = '[[DIRECT_IMAGE_AGENT_REGION]]';

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
