import type { Metadata, Viewport } from 'next';
import { Fraunces, Geist, Geist_Mono, Playfair_Display, DM_Sans, DM_Mono } from 'next/font/google';
import './globals.css';
import { PostHogProvider } from '@/components/posthog-provider';

// Legacy Saltbush kit — still in use across /rooms/new, /renders, /projects.
const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
  axes: ['opsz'],
});
const geist = Geist({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
});
const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

// Editorial kit — used on /dashboard and the new nexus surfaces per the
// myhome dashboard brief. Warm-luxury interior magazine feel.
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
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: '#FAF7F2',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en-AU"
      suppressHydrationWarning
      className={`${fraunces.variable} ${geist.variable} ${geistMono.variable} ${playfair.variable} ${dmSans.variable} ${dmMono.variable}`}
    >
      <body className="min-h-screen bg-paper bg-grain text-ink antialiased">
        <PostHogProvider>{children}</PostHogProvider>
      </body>
    </html>
  );
}
