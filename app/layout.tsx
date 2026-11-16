import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DSHS WORLD · Project SOLGAE",
  description: "대구과학고등학교 오픈소스 360° 정지 파노라마 가상투어",
  icons: {
    icon: "/favicon.svg?v=2",
    shortcut: "/favicon.svg?v=2",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className="antialiased">{children}</body>
    </html>
  );
}
