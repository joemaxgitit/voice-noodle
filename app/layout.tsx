import type { Metadata, Viewport } from "next";
import "./globals.css";
import ToneKey from "./ToneKey";

export const metadata: Metadata = {
  title: "Voice Noodle",
  description: "Private tone and delivery training.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#17171a",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        {children}
        <ToneKey />
      </body>
    </html>
  );
}
