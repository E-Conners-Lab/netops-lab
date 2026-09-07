import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'NetOps Lab: Branch Online',
  description: 'A 3D networking training prototype with Cisco-style troubleshooting and topology simulation.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
