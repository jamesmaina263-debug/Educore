import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ServiceWorkerRegister } from "@/components/pwa/service-worker-register";
import { SITE_URL, SITE_NAME } from "@/lib/site";

// Deliberately not using next/font/google here: it requires a build-time
// fetch to Google Fonts, which fails in restricted-network environments
// and adds an external dependency this project doesn't need. EduCore's
// non-functional requirements call for reliable performance on patchy
// connectivity, so we ship with the system font stack (defined in
// globals.css) instead. Swap in a self-hosted variable font later if the
// design system calls for one.

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "EduCore",
  description: "School management platform for Kenyan schools",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "EduCore",
  },
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  // App-wide fallback OG/Twitter data -- individual marketing pages
  // (Section 9 of the roadmap) override title/description/url per page;
  // this is what non-marketing routes (e.g. /login) fall back to.
  openGraph: {
    title: "EduCore",
    description: "School management platform for Kenyan schools",
    siteName: SITE_NAME,
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "EduCore",
    description: "School management platform for Kenyan schools",
  },
};

export const viewport: Viewport = {
  themeColor: "#1e3a8a",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      {/* GTM (GTM-MGV2XHBB) deliberately does NOT live here anymore -- this
          layout wraps every route in the app, including the authenticated
          school app ((app) route group: student, health, finance,
          discipline, biometric-kiosk pages) and the platform admin console
          ((admin) route group). GTM was briefly loaded here site-wide,
          which meant analytics/advertising tags could fire on pages
          showing real student PII -- a mismatch with both the site's
          privacy page (which states no analytics cookies are set) and the
          admin analytics page's own stated scope ("public marketing
          website" performance only). It now lives in
          src/app/(marketing)/layout.tsx instead, alongside
          MarketingAnalytics (Plausible) -- see that file's comment. */}
      <body className="min-h-full flex flex-col">
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
