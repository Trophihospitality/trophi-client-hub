import { supabase } from '@/integrations/supabase/client';

export const AVATAR_BUCKET = 'trophi-avatars';
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024; // 5 MB
export const ALLOWED_AVATAR_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const AVATAR_ACCEPT = ALLOWED_AVATAR_MIME.join(',');

/** Validate a picked file before we ever try to upload. */
export function validateAvatarFile(file: File): { ok: true } | { ok: false; error: string } {
  const mt = (file.type || '').toLowerCase();
  if (!(ALLOWED_AVATAR_MIME as readonly string[]).includes(mt)) {
    return { ok: false, error: 'Please upload a JPG, PNG, or WebP image.' };
  }
  if (file.size > MAX_AVATAR_BYTES) {
    return { ok: false, error: 'Image must be 5 MB or smaller.' };
  }
  return { ok: true };
}

/** Load an image element from a File (for the crop dialog). */
export function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read image')); };
    img.src = url;
  });
}

export type CropTransform = {
  /** Natural image size */
  imageWidth: number;
  imageHeight: number;
  /** CSS pixel size of the square viewport the user is cropping through */
  viewSize: number;
  /** Zoom multiplier applied on top of the base "fit-to-cover" scale */
  zoom: number;
  /** Pan offset of the image inside the viewport, in CSS pixels (top-left of image relative to viewport 0,0) */
  offsetX: number;
  offsetY: number;
};

/**
 * Render the visible square viewport at `outSize` and encode as JPEG.
 * The visible area of the viewport IS what gets saved — 1:1 with the crop UI.
 */
export async function renderCroppedSquareJpeg(
  img: HTMLImageElement,
  t: CropTransform,
  outSize = 512,
  quality = 0.9,
): Promise<Blob> {
  // Base scale to cover the viewport with the image (like object-fit: cover).
  const base = Math.max(t.viewSize / t.imageWidth, t.viewSize / t.imageHeight);
  const scale = base * t.zoom;
  // Rendered image size, in CSS pixels.
  const dw = t.imageWidth * scale;
  const dh = t.imageHeight * scale;

  const canvas = document.createElement('canvas');
  canvas.width = outSize;
  canvas.height = outSize;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unsupported');

  const px = outSize / t.viewSize;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, t.offsetX * px, t.offsetY * px, dw * px, dh * px);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Failed to encode image'))),
      'image/jpeg',
      quality,
    );
  });
}

/** Legacy center-crop, kept for callers not yet updated. Prefer the crop dialog. */
export async function cropToSquareJpeg(file: File, size = 512, quality = 0.9): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const sx = Math.floor((bitmap.width - side) / 2);
  const sy = Math.floor((bitmap.height - side) / 2);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unsupported');
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, size, size);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Failed to encode image'))),
      'image/jpeg',
      quality,
    );
  });
}

export async function uploadAvatarBlob(userId: string, blob: Blob): Promise<string> {
  if (blob.size > MAX_AVATAR_BYTES) {
    throw new Error('Cropped image is larger than 5 MB');
  }
  const path = `${userId}/${Date.now()}.jpg`;
  const { error } = await supabase.storage.from(AVATAR_BUCKET).upload(path, blob, {
    contentType: 'image/jpeg',
    upsert: false,
  });
  if (error) throw new Error(error.message);
  return path;
}

export async function signAvatar(path: string | null | undefined, expiresIn = 3600): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await supabase.storage.from(AVATAR_BUCKET).createSignedUrl(path, expiresIn);
  if (error) return null;
  return data?.signedUrl ?? null;
}

export function initialsFromName(name: string | null | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0] + parts[parts.length - 1]![0]).toUpperCase();
}
