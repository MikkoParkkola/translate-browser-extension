import type { OffscreenCropRect } from './message-routing';

export async function cropImageToDataUrl(
  imageData: string,
  rect: OffscreenCropRect,
  devicePixelRatio = 1
): Promise<string> {
  const img = new Image();
  img.src = imageData;
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Failed to load image for cropping'));
  });

  const canvas = document.createElement('canvas');
  canvas.width = rect.width * devicePixelRatio;
  canvas.height = rect.height * devicePixelRatio;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(
    img,
    rect.x * devicePixelRatio,
    rect.y * devicePixelRatio,
    rect.width * devicePixelRatio,
    rect.height * devicePixelRatio,
    0,
    0,
    canvas.width,
    canvas.height
  );

  return canvas.toDataURL('image/png');
}
