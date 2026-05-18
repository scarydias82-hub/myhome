'use client';

import { useEffect } from 'react';
import posthog from 'posthog-js';
import { publicEnv } from '@/lib/env';

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!publicEnv.NEXT_PUBLIC_POSTHOG_KEY) return;
    if (posthog.__loaded) return;

    posthog.init(publicEnv.NEXT_PUBLIC_POSTHOG_KEY, {
      api_host: publicEnv.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://app.posthog.com',
      capture_pageview: true,
      capture_pageleave: true,
      person_profiles: 'identified_only',
    });
  }, []);

  return <>{children}</>;
}
