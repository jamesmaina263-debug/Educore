import { isSafePublicUrl, htmlToText } from "./enrichment";

const UA = "Mozilla/5.0 (compatible; EduCore-Outreach/1.0; school contact lookup)";

export type FetchedPage = { url: string; html: string; text: string };

/**
 * Fetches a public web page for contact lookup. Every hop (including redirects, which are followed
 * manually, max 3) is re-checked with isSafePublicUrl so a public page can't bounce us to an
 * internal address. Hard caps on time and size. Returns null on ANY failure; enrichment treats
 * "couldn't read the page" as "nothing found", never as an error to guess around.
 */
export async function safeFetchPage(
  startUrl: string,
  opts: { timeoutMs?: number; maxBytes?: number } = {},
): Promise<FetchedPage | null> {
  const timeoutMs = opts.timeoutMs ?? 8000;
  const maxBytes = opts.maxBytes ?? 400_000;
  let url = startUrl;
  try {
    for (let hop = 0; hop <= 3; hop++) {
      if (!isSafePublicUrl(url)) return null;
      const res = await fetch(url, {
        redirect: "manual",
        headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
        signal: AbortSignal.timeout(timeoutMs),
        cache: "no-store",
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) return null;
        url = new URL(loc, url).toString();
        continue;
      }
      if (!res.ok || !res.body) return null;
      const type = (res.headers.get("content-type") ?? "").toLowerCase();
      if (type && !type.includes("html") && !type.includes("text/plain")) return null;

      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      while (total < maxBytes) {
        const { done, value } = await reader.read();
        if (done || !value) break;
        chunks.push(value);
        total += value.byteLength;
      }
      void reader.cancel().catch(() => undefined);
      const html = new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks));
      return { url, html, text: htmlToText(html) };
    }
    return null;
  } catch {
    return null;
  }
}
