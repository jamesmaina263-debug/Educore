"use client";

import { useEffect } from "react";

// Last-resort boundary: only shown when the root layout itself fails, which replaces the whole
// document. It therefore cannot rely on global styles, fonts or any component -- everything is
// inline. Route-level failures are handled by the error.tsx files, which keep the app chrome.
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
    if (error.digest) return; // server-side render errors are already captured by onRequestError
    import("@sentry/nextjs")
      .then((Sentry) => Sentry.captureException(error))
      .catch(() => {
        // Best-effort reporting only.
      });
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
          color: "#1f2430",
          background: "#f7f8fa",
        }}
      >
        <div role="alert" style={{ maxWidth: 440, textAlign: "center" }}>
          <h1 style={{ fontSize: 20, margin: "0 0 8px" }}>EduCore couldn&apos;t load</h1>
          <p style={{ fontSize: 14, lineHeight: 1.5, color: "#5b6270", margin: "0 0 20px" }}>
            Something went wrong on our side. Please try again. If it keeps happening, contact{" "}
            <a href="mailto:support@educoreafrica.com" style={{ color: "inherit" }}>
              support@educoreafrica.com
            </a>
            {error.digest ? ` and quote reference ${error.digest}` : ""}.
          </p>
          <button
            type="button"
            onClick={() => retry()}
            style={{
              cursor: "pointer",
              border: 0,
              borderRadius: 6,
              padding: "9px 18px",
              fontSize: 14,
              fontWeight: 500,
              color: "#fff",
              background: "#1f3a8a",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
