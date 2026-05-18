import { createClient } from '@supabase/supabase-js';
import type { Database } from '@myhome/types';
import { publicEnv } from '@/lib/env';

// Service-role client. Bypasses RLS. Use ONLY in server routes/handlers, never
// import this from a client component. Used for writes the user shouldn't be
// able to forge (e.g. inserting a render row with status updates from a worker).
export function createAdminClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!publicEnv.NEXT_PUBLIC_SUPABASE_URL || !serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_URL is not set.');
  }
  return createClient<Database>(publicEnv.NEXT_PUBLIC_SUPABASE_URL, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
