'use client';

import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/client';

export function GoogleAuthButton({ next }: { next?: string }) {
  async function handleClick() {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(
          next ?? '/dashboard',
        )}`,
      },
    });
  }

  return (
    <Button variant="outline" className="w-full" onClick={handleClick} type="button">
      Continue with Google
    </Button>
  );
}
