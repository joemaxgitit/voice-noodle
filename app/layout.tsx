import type { Metadata, Viewport } from "next";
import "./globals.css";
import ToneKey from "./ToneKey";

/*
  Link previews. The absolute URL matters -- scrapers cannot resolve a
  relative path. Declaring width and height helps some of them, and
  twitter.card must be set or Discord renders an 80x80 thumbnail rather
  than the full card.
*/
const SITE = "https://voicenoodle.com";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: "Voice Noodle",
  description: "Script karaoke for phone teams. Learn the words, master the delivery.",
  openGraph: {
    title: "Voice Noodle",
    description:
      "Script karaoke for phone teams. Learn the words, master the delivery.",
    url: SITE,
    siteName: "Voice Noodle",
    type: "website",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "Voice Noodle — script karaoke for phone teams",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Voice Noodle",
    description:
      "Script karaoke for phone teams. Learn the words, master the delivery.",
    images: ["/og.png"],
  },
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
