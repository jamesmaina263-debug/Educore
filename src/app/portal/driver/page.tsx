import type { Metadata } from "next";
import { DriverTracker } from "@/components/transport/driver-tracker";

export const metadata: Metadata = {
  title: "EduCore Driver",
  manifest: "/driver.webmanifest",
  robots: { index: false, follow: false },
};

// Public shell on purpose: a driver's phone has no staff login. The page only ever talks to /api/driver/*, which
// accept a tracker device token and nothing else. Without a valid token (or with the feature off for the school)
// it shows nothing about any school.
export default function DriverPage() {
  return (
    <main className="mx-auto max-w-md space-y-4 p-4">
      <h1 className="text-xl font-semibold">EduCore Driver</h1>
      <DriverTracker />
    </main>
  );
}
