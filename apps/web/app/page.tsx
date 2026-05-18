import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function LandingPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 py-20">
      <div className="mx-auto flex max-w-2xl flex-col items-center text-center">
        <p className="text-sm uppercase tracking-widest text-muted-foreground">myHome · AU</p>
        <h1 className="mt-4 text-balance text-4xl font-semibold leading-tight sm:text-5xl">
          Restyle any room. Shop every piece.
        </h1>
        <p className="mt-6 text-balance text-lg text-muted-foreground">
          Snap your living room. Pick a style. Get a photorealistic restyle where every chair, rug
          and lamp is a real product from an Australian retailer.
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <Button asChild size="lg">
            <Link href="/signup">Get started</Link>
          </Button>
          <Button asChild size="lg" variant="secondary">
            <Link href="/login">I have an account</Link>
          </Button>
        </div>
        <p className="mt-12 text-xs text-muted-foreground">
          M0 skeleton · v0.0.0 · render pipeline lands in M1
        </p>
      </div>
    </main>
  );
}
