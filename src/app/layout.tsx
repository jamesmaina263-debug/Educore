import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ServiceWorkerRegister } from "@/components/pwa/service-worker-register";

// Deliberately not using next/font/google here: it requires a build-time
// fetch to Google Fonts, which fails in restricted-network environments
// and adds an external dependency this project doesn't need. EduCore's
// non-functional requirements call for reliable performance on patchy
// connectivity, so we ship with the system font stack (defined in
// globals.css) instead. Swap in a self-hosted variable font later if the
// design system calls for one.

export const metadata: Metadata = {
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
      <body className="min-h-full flex flex-col">
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
