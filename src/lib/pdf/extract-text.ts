import { extractText, getDocumentProxy } from "unpdf";

/**
 * Extract the plain text of a PDF.
 *
 * Uses `unpdf` (serverless-safe PDF.js build) rather than `pdf-parse`, whose
 * v1 entry point runs a debug block at import time under bundlers and throws
 * ENOENT on './test/data/05-versions-space.pdf', before ever reading the
 * uploaded file.
 *
 * Throws on a corrupt / encrypted / unparseable PDF so callers can show their
 * "couldn't read that PDF" message. Returns "" for a PDF with no text layer.
 */
export async function extractPdfText(data: ArrayBuffer | Uint8Array): Promise<string> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: true });
  return text.trim();
}
