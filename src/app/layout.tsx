import type { Metadata } from "next";
import "./globals.css";

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
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
