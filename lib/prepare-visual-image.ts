import { VISUAL_IMAGE_MAX_BYTES, VISUAL_IMAGE_MAX_DIMENSION } from './visual-display';

/** Preserve the entire picture/map; resize only, never crop. Server repeats authoritative decoding. */
export async function prepareVisualImage(file: File): Promise<string> {
  if (!['image/jpeg','image/png','image/webp'].includes(file.type) || !file.size || file.size > 5 * 1024 * 1024) throw new Error('Choose a PNG, JPEG or WebP picture up to 5 MB.');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('That picture could not be opened.')); image.src = url; });
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 40_000_000) throw new Error('Choose a smaller picture.');
    for (const dimension of [VISUAL_IMAGE_MAX_DIMENSION, 768, 512]) {
      const scale = Math.min(1, dimension / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext('2d'); if (!context) throw new Error('Your browser could not prepare this picture.');
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      for (const quality of [.8, .6, .4]) {
        const result = canvas.toDataURL('image/webp', quality);
        if (result.startsWith('data:image/webp;base64,') && Math.ceil(result.split(',')[1].length * 3 / 4) <= VISUAL_IMAGE_MAX_BYTES) return result;
      }
    }
    throw new Error('Choose a less detailed picture.');
  } finally { URL.revokeObjectURL(url); }
}
