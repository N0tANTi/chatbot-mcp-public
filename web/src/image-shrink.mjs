// Images reach the model inline, which takes at most 5 MB each. Larger photos are re-encoded in
// the browser (long side ≤ 2400 px, JPEG) before upload; the model downsizes beyond that anyway.
export const IMAGE_TARGET = 3.5 * 1024 * 1024, MAX_SIDE = 2400;
export function fitWithin(width, height, max = MAX_SIDE) {
  const scale = Math.min(1, max / Math.max(width, height));
  return {width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale))};
}
export const needsShrink = file => /^image\/(png|jpeg|webp)$/.test(file.type) && file.size > IMAGE_TARGET;
export const jpegName = name => `${name.replace(/\.(png|webp|jpe?g)$/i, '')}.jpg`;
export async function shrinkImage(file) {
  if (!needsShrink(file)) return file;
  const bitmap = await createImageBitmap(file, {imageOrientation: 'from-image'});
  try {
    let {width, height} = fitWithin(bitmap.width, bitmap.height);
    for (;;) {
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height); ctx.drawImage(bitmap, 0, 0, width, height);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .88));
      if (!blob) return file;
      if (blob.size <= IMAGE_TARGET || Math.max(width, height) <= 800) return new File([blob], jpegName(file.name), {type: 'image/jpeg', lastModified: file.lastModified});
      width = Math.round(width * .8); height = Math.round(height * .8);
    }
  } finally { bitmap.close?.(); }
}
