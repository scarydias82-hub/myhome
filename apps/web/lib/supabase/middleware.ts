import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import type { Database } from '@myhome/types';
import { publicEnv, isSupabaseConfigured } from '@/lib/env';

interface CookieToSet {
  name: string;
  value: string;
  options?: CookieOptions;
}

const PROTECTED_PREFIXES = ['/dashboard', '/rooms', '/renders', '/settings'];

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  // Without Supabase configured, skip session refresh. Protected routes will be
  // unreachable anyway (the page itself errors with a clear message).
  if (!isSupabaseConfigured) {
    return response;
  }

  const supabase = createServerClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL!,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // IMPORTANT: Do not run code between createServerClient and getUser.
  // getUser refreshes the auth token and writes the new cookies.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isProtected = PROTECTED_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));

  if (isProtected && !user) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', path);
    return NextResponse.redirect(url);
  }

  return response;
}
