import type { Metadata, Viewport } from 'next';
import { Playfair_Display, DM_Sans, DM_Mono } from 'next/font/google';
import './globals.css';
import { PostHogProvider } from '@/components/posthog-provider';
import { PWARegister } from '@/components/pwa-register';

// Editorial brand fonts — Playfair Display (display), DM Sans (body),
// DM Mono (metadata + caps). The legacy Saltbush font vars
// (--font-display, --font-body, --font-mono) are aliased to these in
// globals.css so existing `font-display`/`font-sans`/`font-mono`
// Tailwind classes also render the editorial fonts. The Fraunces / Geist
// imports were removed when the rebrand swept across all surfaces.
const playfair = Playfair_Display({
  subsets: ['latin'],
  variable: '--font-serif',
  display: 'swap',
  weight: ['400', '500', '600'],
});
const dmSans = DM_Sans({
  subsets: ['latin'],
  variable: '--font-dmsans',
  display: 'swap',
  weight: ['300', '400', '500'],
});
const dmMono = DM_Mono({
  subsets: ['latin'],
  variable: '--font-dmmono',
  display: 'swap',
  weight: ['400', '500'],
});

export const metadata: Metadata = {
  title: 'myMaison · your personal design studio',
  description:
    'From inspiration to a fully shopped room — in minutes. myMaison is an Australian design studio in your browser: take a photo of your room, choose a direction, and see every piece rendered as a real, buyable product from an AU retailer.',
  applicationName: 'myMaison',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'myMaison',
    statusBarStyle: 'default',
  },
  icons: {
    icon: [{ url: '/icon.svg', type: 'image/svg+xml' }],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: '#FAF7F2',
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en-AU"
      suppressHydrationWarning
      className={`${playfair.variable} ${dmSans.variable} ${dmMono.variable}`}
    >
      <body className="min-h-screen bg-editorial-cream bg-grain font-dmsans text-editorial-ink antialiased">
        <PostHogProvider>{children}</PostHogProvider>
        <PWARegister />
      </body>
    </html>
  );
}
