import { redirect } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { isSupabaseConfigured } from '@/lib/env';
import { createClient } from '@/lib/supabase/server';

export default async function DashboardPage() {
  if (!isSupabaseConfigured) {
    redirect('/login');
  }
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/dashboard');

  return (
    <main className="container mx-auto max-w-5xl px-6 py-12">
      <header className="mb-10 flex items-center justify-between">
        <div>
          <p className="text-sm uppercase tracking-widest text-muted-foreground">Dashboard</p>
          <h1 className="mt-1 text-3xl font-semibold">Hi, {user.email}</h1>
        </div>
        <form action="/auth/signout" method="post">
          <Button type="submit" variant="outline">
            Sign out
          </Button>
        </form>
      </header>

      <section className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Your rooms</CardTitle>
            <CardDescription>Photos you've uploaded. Empty until M1 ships.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">No rooms yet.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Your renders</CardTitle>
            <CardDescription>Restyled rooms with shoppable picking lists.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">No renders yet.</p>
          </CardContent>
        </Card>
      </section>

      <section className="mt-10">
        <Card>
          <CardHeader>
            <CardTitle>Coming soon</CardTitle>
            <CardDescription>
              Upload a photo, pick a style, get a photorealistic restyle with shoppable AU
              products. M1 lands the render pipeline.
            </CardDescription>
          </CardHeader>
        </Card>
      </section>
    </main>
  );
}
