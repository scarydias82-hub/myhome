import type { Metadata, Viewport } from 'next';
import './globals.css';
import { PostHogProvider } from '@/components/posthog-provider';

export const metadata: Metadata = {
  title: 'myHome — restyle any room, shop the look',
  description:
    'Take a photo of your room. Pick a style. Get a photorealistic restyle with every item shoppable from an Australian retailer.',
  applicationName: 'myHome',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#1c1815',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-AU" suppressHydrationWarning>
      <body className="min-h-screen bg-background font-sans text-foreground">
        <PostHogProvider>{children}</PostHogProvider>
      </body>
    </html>
  );
}
