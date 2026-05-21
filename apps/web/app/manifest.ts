import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'myMaison · your personal design studio',
    short_name: 'myMaison',
    description:
      'From inspiration to a fully shopped room — in minutes. An Australian design studio in your browser.',
    start_url: '/dashboard',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#FAF7F2',
    theme_color: '#FAF7F2',
    lang: 'en-AU',
    dir: 'ltr',
    categories: ['lifestyle', 'shopping', 'design'],
    icons: [
      {
        src: '/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
      {
        src: '/apple-icon',
        sizes: '180x180',
        type: 'image/png',
        purpose: 'any',
      },
    ],
  };
}
