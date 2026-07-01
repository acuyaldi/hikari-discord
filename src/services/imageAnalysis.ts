import { IMAGE_ANALYSIS_ENABLED, IMAGE_MAX_SIZE_MB } from '../config/env';

export const SUPPORTED_IMAGE_CONTENT_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
]);

export interface ImageAttachmentLike {
  contentType?: string | null;
  size?: number | null;
  url?: string;
}

export function normalizedImageContentType(attachment: ImageAttachmentLike): string {
  return (attachment.contentType ?? '').split(';')[0].trim().toLowerCase();
}

export function isSupportedImageAttachment(attachment: ImageAttachmentLike): boolean {
  return SUPPORTED_IMAGE_CONTENT_TYPES.has(normalizedImageContentType(attachment));
}

export function getImageAttachmentRejection(
  attachment: ImageAttachmentLike,
  options: {
    enabled?: boolean;
    maxSizeMb?: number;
  } = {},
): string | null {
  const enabled = options.enabled ?? IMAGE_ANALYSIS_ENABLED;
  const maxSizeMb = options.maxSizeMb ?? IMAGE_MAX_SIZE_MB;
  const size = attachment.size ?? 0;
  const maxBytes = maxSizeMb * 1024 * 1024;

  if (!enabled) {
    return 'Analisis gambar sedang dimatikan sementara.';
  }

  if (!isSupportedImageAttachment(attachment)) {
    return 'Aku baru bisa membaca gambar PNG, JPEG, atau WebP.';
  }

  if (size > maxBytes) {
    return `Gambar itu terlalu besar buat kubaca. Maksimal ${maxSizeMb} MB ya.`;
  }

  return null;
}
