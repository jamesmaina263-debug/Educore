// Shared checks for school-logo uploads (Settings → Branding).
//
// Why this exists: logos live in a PUBLIC storage bucket and are rendered on tenant-facing
// pages, receipts and ID cards. We accept raster formats only (SVG can carry script -- see
// the school-logos bucket's allowed_mime_types) and verify the file's actual bytes, not just
// the client-declared MIME type, which an uploader fully controls.

export const LOGO_BUCKET = "school-logos";
export const MAX_LOGO_BYTES = 2 * 1024 * 1024; // matches the school-logos bucket's file_size_limit

export type LogoType = "image/png" | "image/jpeg" | "image/webp";

export const ALLOWED_LOGO_TYPES: readonly LogoType[] = ["image/png", "image/jpeg", "image/webp"];

const EXTENSIONS: Record<LogoType, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/** Identify a raster logo format from its leading bytes; null if it isn't PNG/JPEG/WebP. */
export function sniffLogoType(bytes: Uint8Array): LogoType | null {
  const startsWith = (sig: number[], offset = 0) =>
    bytes.length >= offset + sig.length && sig.every((b, i) => bytes[offset + i] === b);

  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith([0xff, 0xd8, 0xff])) return "image/jpeg";
  // WebP: "RIFF" <4-byte size> "WEBP"
  if (startsWith([0x52, 0x49, 0x46, 0x46]) && startsWith([0x57, 0x45, 0x42, 0x50], 8)) {
    return "image/webp";
  }
  return null;
}

export type LogoCheck = { error: string } | { contentType: LogoType; extension: string };

export async function validateLogoFile(file: File): Promise<LogoCheck> {
  if (file.size === 0) return { error: "Choose a logo image to upload." };
  if (file.size > MAX_LOGO_BYTES) return { error: "Logo must be 2MB or smaller." };
  if (!(ALLOWED_LOGO_TYPES as readonly string[]).includes(file.type)) {
    return { error: "Logo must be a PNG, JPEG, or WebP image." };
  }

  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const sniffed = sniffLogoType(head);
  if (!sniffed || sniffed !== file.type) {
    return { error: "That file doesn't look like a valid PNG, JPEG, or WebP image." };
  }
  return { contentType: sniffed, extension: EXTENSIONS[sniffed] };
}
