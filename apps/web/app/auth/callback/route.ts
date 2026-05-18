import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const next = url.searchParams.get('next') ?? '/dashboard';

  if (code) {
    const supabase = createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      const fail = url.clone();
      fail.pathname = '/login';
      fail.search = `?error=${encodeURIComponent(error.message)}`;
      return NextResponse.redirect(fail);
    }
  }

  const dest = url.clone();
  dest.pathname = next;
  dest.search = '';
  return NextResponse.redirect(dest);
}
