import { WAVEFORM_PHOTO_MAX_BYTES } from './account-model';

const INPUT_MAX_BYTES = 5 * 1024 * 1024;
const PHOTO_SIZE = 256;

export async function prepareProfilePhoto(file: File): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new Error('Choose a JPEG, PNG or WebP photo.');
  }
  if (!file.size || file.size > INPUT_MAX_BYTES) {
    throw new Error('Choose a photo smaller than 5 MB.');
  }

  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('That photo could not be opened. Try another image.'));
      image.src = url;
    });
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('That photo could not be opened. Try another image.');

    const canvas = document.createElement('canvas');
    canvas.width = PHOTO_SIZE;
    canvas.height = PHOTO_SIZE;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Your browser could not prepare this photo. Try another browser.');
    const size = Math.min(image.naturalWidth, image.naturalHeight);
    context.fillStyle = '#101110';
    context.fillRect(0, 0, PHOTO_SIZE, PHOTO_SIZE);
    context.drawImage(image, (image.naturalWidth - size) / 2, (image.naturalHeight - size) / 2, size, size, 0, 0, PHOTO_SIZE, PHOTO_SIZE);
    const photo = canvas.toDataURL('image/jpeg', 0.85);
    if (!photo.startsWith('data:image/jpeg;base64,') || Math.ceil(photo.split(',')[1].length * 3 / 4) > WAVEFORM_PHOTO_MAX_BYTES) {
      throw new Error('That photo could not be made small enough. Try another image.');
    }
    return photo;
  } finally {
    URL.revokeObjectURL(url);
  }
}
