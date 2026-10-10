import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { salon } from "@/lib/salon";

const bodoni = localFont({
  src: "./fonts/BodoniModa-Regular.ttf",
  variable: "--font-bodoni",
  weight: "400",
  display: "swap",
});

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
  display: "swap",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
  preload: false,
});

export const metadata: Metadata = {
  title: `${salon.name} — A little change. All you.`,
  description:
    `Explore haircuts, color, blowouts, and conditioning treatments at ${salon.name}. Compare service prices and appointment lengths, choose an available time, and book your appointment online.`,
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f5f3f1",
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${bodoni.variable} ${geistSans.variable} ${geistMono.variable}`}>
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
