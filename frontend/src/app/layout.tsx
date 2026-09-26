import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

// Loaded through next/font so the file is served from our own domain and
// the text does not flicker while a web font downloads.
const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

export const metadata: Metadata = {
  title: 'Meet Translate',
  description: 'Video meetings with live translated captions.',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={inter.variable}>
      {/* No shared nav/footer here on purpose -- the meeting room is a
          full-screen call UI, not a page with chrome around it. */}
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
