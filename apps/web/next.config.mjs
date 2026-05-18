import { withSentryConfig } from '@sentry/nextjs';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '*.supabase.co' },
      { protocol: 'https', hostname: '*.supabase.in' },
    ],
  },
  // @huggingface/transformers ships native ONNX Runtime binaries that can't
  // be webpack-bundled. Marking them as external keeps them as require()s
  // resolved at runtime by Node — works locally and on Vercel.
  serverExternalPackages: ['@huggingface/transformers', 'onnxruntime-node', 'sharp'],
  experimental: {
    serverActions: { allowedOrigins: ['localhost:3000'] },
  },
};

const sentryEnabled = !!process.env.SENTRY_DSN && !!process.env.SENTRY_AUTH_TOKEN;

export default sentryEnabled
  ? withSentryConfig(nextConfig, {
      silent: true,
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      widenClientFileUpload: true,
      hideSourceMaps: true,
      disableLogger: true,
    })
  : nextConfig;
