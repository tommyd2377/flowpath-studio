/** Plain, bounded content. Permissions and tool authority live in the host, never in this data. */
export const VISUAL_IMAGE_LIMIT = 4;
export const VISUAL_IMAGE_MAX_BYTES = 32 * 1024;
export const VISUAL_IMAGE_MAX_DIMENSION = 1024;
export const VISUAL_TEXT_LIMIT = 2_000;
export const VISUAL_CONFIGURATION_MAX_BYTES = 192 * 1024;
export type DisplayTextContent = { type: 'text'; text: string };
export type DisplayImageContent = { type: 'image'; id: string; title: string; description: string; src: string };
export type VisualImage = Omit<DisplayImageContent, 'type'> & { text: string };
export type VisualDisplayConfiguration = { type: 'visual'; version: 1; images: VisualImage[] };
export type VisualDisplayAction = { action: 'read' | 'show' | 'hide' | 'select' | 'next' | 'previous' | 'replace_text' | 'append_text'; imageId: string; text: string };
export type VisualDisplayState = { visible: boolean; requested: boolean; imageId: string | null; text: string; message: string };
const object = (v: unknown): Record<string, unknown> | null => !!v && typeof v === 'object' && !Array.isArray(v)
  && [Object.prototype, null].includes(Object.getPrototypeOf(v)) && Object.values(Object.getOwnPropertyDescriptors(v)).every(d => 'value' in d) ? v as Record<string, unknown> : null;
export const validDisplayText = (v: unknown, max = VISUAL_TEXT_LIMIT): v is string => typeof v === 'string' && v.length <= max
  && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v);
export const validVisualImageId = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(v);
/** Syntax only. New raster bytes must also be decoded/normalized on the server. */
export const validVisualImageSource = (v: unknown): v is string => typeof v === 'string'
  && v.length <= Math.ceil(VISUAL_IMAGE_MAX_BYTES / 3) * 4 + 32
  && /^data:image\/(?:png|jpeg|webp);base64,(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(v)
  && v.slice(v.indexOf(',') + 1).length > 0;

export function validateVisualDisplay(input: unknown): { ok: true; value: VisualDisplayConfiguration | null } | { ok: false } {
  try {
    if (input == null) return { ok: true, value: null };
    const row = object(input);
    if (!row || Object.keys(row).length !== 3 || row.type !== 'visual' || row.version !== 1
      || !Array.isArray(row.images) || row.images.length > VISUAL_IMAGE_LIMIT) return { ok: false };
    const images: VisualImage[] = [];
    for (const value of row.images) {
      const image = object(value);
      if (!image || Object.keys(image).length !== 5 || !validVisualImageId(image.id)
        || !validDisplayText(image.title, 80) || !image.title.trim() || /[\r\n\t]/.test(image.title)
        || !validDisplayText(image.description, 500) || !image.description.trim()
        || !validDisplayText(image.text) || !validVisualImageSource(image.src)) return { ok: false };
      images.push({ id: image.id, title: image.title.trim(), description: image.description.trim(), src: image.src, text: image.text });
    }
    if (new Set(images.map(i => i.id)).size !== images.length
      || new Set(images.map(i => i.title.toLocaleLowerCase('en-US'))).size !== images.length) return { ok: false };
    const value: VisualDisplayConfiguration = { type: 'visual', version: 1, images };
    if (new TextEncoder().encode(JSON.stringify(value)).byteLength > VISUAL_CONFIGURATION_MAX_BYTES) return { ok: false };
    return { ok: true, value };
  } catch { return { ok: false }; }
}
export function visualDisplayAction(input: unknown): VisualDisplayAction | null {
  const row = object(input);
  if (!row || Object.keys(row).length !== 3 || !['read','show','hide','select','next','previous','replace_text','append_text'].includes(String(row.action))
    || typeof row.imageId !== 'string' || !validDisplayText(row.text)) return null;
  if (row.action === 'select' ? !validVisualImageId(row.imageId) : row.imageId !== '') return null;
  if (!['replace_text','append_text'].includes(String(row.action)) && row.text !== '') return null;
  return { action: row.action as VisualDisplayAction['action'], imageId: row.imageId, text: row.text };
}
export const emptyVisualDisplayState = (): VisualDisplayState => ({ visible: false, requested: false, imageId: null, text: '', message: '' });
/** Metadata alone is context, never evidence of model visual understanding. Raster bytes stay out of voice prompts. */
export function visualDisplayCatalogue(config?: VisualDisplayConfiguration | null) {
  return config?.images.map(({ id, title, description, text }) => ({ id, title, description, text })) ?? [];
}
