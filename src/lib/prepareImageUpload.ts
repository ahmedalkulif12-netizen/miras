/**
 * Shrink camera/gallery images to a JPEG before base64 upload.
 * Phone photos often exceed the API body limit or arrive with an empty MIME type.
 */

const MAX_EDGE = 1600;
const TARGET_BYTES = 1_400_000;
const HARD_INPUT_BYTES = 25 * 1024 * 1024;

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => {
      console.error('[upload] file read failed', reader.error);
      reject(new Error('FILE_READ_FAILED'));
    };
    reader.onload = () => resolve(String(reader.result || ''));
    reader.readAsDataURL(blob);
  });
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('IMAGE_ENCODE_FAILED'));
      },
      'image/jpeg',
      quality
    );
  });
}

async function drawScaled(file: File): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height, 1));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('IMAGE_DECODE_FAILED');
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    bitmap.close();
  }
}

export async function prepareImageUpload(file: File): Promise<{
  contentBase64: string;
  contentType: 'image/jpeg';
  fileName: string;
}> {
  if (!file.size) {
    throw new Error('DOCUMENT_EMPTY');
  }
  if (file.size > HARD_INPUT_BYTES) {
    throw new Error('PHOTO_TOO_LARGE');
  }

  let canvas: HTMLCanvasElement;
  try {
    canvas = await drawScaled(file);
  } catch (error) {
    console.error('[upload] image decode failed', {
      name: file.name,
      type: file.type,
      size: file.size,
      message: error instanceof Error ? error.message : error,
    });
    throw new Error('IMAGE_DECODE_FAILED');
  }

  let quality = 0.82;
  let blob = await canvasToJpeg(canvas, quality);
  while (blob.size > TARGET_BYTES && quality > 0.46) {
    quality = Math.round((quality - 0.12) * 100) / 100;
    blob = await canvasToJpeg(canvas, quality);
  }
  if (blob.size > 4.5 * 1024 * 1024) {
    console.error('[upload] compressed image still too large', { bytes: blob.size });
    throw new Error('PHOTO_TOO_LARGE');
  }

  const dataUrl = await readBlobAsDataUrl(blob);
  const comma = dataUrl.indexOf(',');
  const baseName =
    (file.name || 'photo').replace(/\.[^.]+$/, '').replace(/[^\w.\-()-]+/g, '_') || 'photo';

  return {
    contentBase64: comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl,
    contentType: 'image/jpeg',
    fileName: `${baseName.slice(0, 60)}.jpg`,
  };
}
