import { Logo } from '@/components/saltbush/logo';
import { Eyebrow } from '@/components/saltbush/eyebrow';
import { DisplayHeading } from '@/components/saltbush/display-heading';
import { Pill } from '@/components/saltbush/pill';
import { PaletteStrip } from '@/components/saltbush/palette-strip';
import { Hotspot } from '@/components/saltbush/hotspot';
import { ItemCard } from '@/components/saltbush/item-card';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export const metadata = { title: 'Design system — saltbush' };

const swatches = ['#1B1815', '#B7553C', '#5E6A4D', '#A6824A', '#ECE4D5'];

const samplePalette = ['#D9C7A7', '#B7553C', '#5E6A4D', '#8B7355', '#ECE4D5'];

const sampleItems = [
  {
    id: '1',
    category: 'Sofa',
    name: 'Aurora three-seater linen sofa',
    retailer: 'Temple & Webster',
    priceAud: 2199,
    alternativesCount: 4,
  },
  {
    id: '2',
    category: 'Coffee table',
    name: 'Oka oak burl side table',
    retailer: 'Castlery AU',
    priceAud: 849,
    alternativesCount: 3,
  },
  {
    id: '3',
    category: 'Rug',
    name: 'Handwoven jute rug, 240×340',
    retailer: 'IKEA AU',
    priceAud: 399,
    alternativesCount: 6,
  },
];

export default function DesignSystemPage() {
  return (
    <main className="container mx-auto max-w-5xl py-16">
      <header className="mb-16 flex items-center justify-between">
        <Logo size="md" />
        <Eyebrow>Design system · v0</Eyebrow>
      </header>

      <Section eyebrow="01 — Brand" title="The wordmark and clay accent.">
        <div className="flex flex-wrap items-end gap-10">
          <Logo size="sm" />
          <Logo size="md" />
          <Logo size="lg" />
        </div>
      </Section>

      <Section eyebrow="02 — Palette" title="Warm paper, off-black ink, clay accent.">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {[
            { name: 'paper', hex: '#F4EFE6', text: 'ink' },
            { name: 'paper-warm', hex: '#ECE4D5', text: 'ink' },
            { name: 'cream', hex: '#FBF8F2', text: 'ink' },
            { name: 'ink', hex: '#1B1815', text: 'cream' },
            { name: 'ink-soft', hex: '#5C5851', text: 'cream' },
            { name: 'ink-faint', hex: '#8B847A', text: 'cream' },
            { name: 'clay', hex: '#B7553C', text: 'cream' },
            { name: 'clay-soft', hex: '#E8C8B7', text: 'ink' },
            { name: 'olive', hex: '#5E6A4D', text: 'cream' },
            { name: 'gold', hex: '#A6824A', text: 'cream' },
          ].map((c) => (
            <div
              key={c.name}
              className="flex h-24 flex-col justify-between rounded-md p-3"
              style={{ background: c.hex, color: c.text === 'cream' ? '#FBF8F2' : '#1B1815' }}
            >
              <span className="font-mono text-meta uppercase tracking-eyebrow opacity-80">
                {c.name}
              </span>
              <span className="font-mono text-[11px] opacity-70">{c.hex}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section eyebrow="03 — Typography" title="Fraunces × Geist × Geist Mono.">
        <div className="space-y-6">
          <DisplayHeading level={1}>
            Your room, styled like a <em>magazine</em>.
          </DisplayHeading>
          <DisplayHeading level={2}>
            Three steps from <em>photo</em> to picking list.
          </DisplayHeading>
          <DisplayHeading level={3}>
            Calm mornings · <em>warm</em> Japandi
          </DisplayHeading>
          <p className="max-w-2xl text-[18px] leading-relaxed text-ink-soft">
            Body large — Geist 18 / 1.55. Take a photo of your living room and pick a style. We
            give you back a photorealistic restyle with every piece shoppable from an Australian
            retailer.
          </p>
          <p className="max-w-2xl text-[15px] leading-relaxed text-ink">
            Body — Geist 15 / 1.5. Default running text.
          </p>
          <p className="font-mono text-meta uppercase tracking-eyebrow text-clay">
            Meta · Geist Mono 11 · uppercase
          </p>
        </div>
      </Section>

      <Section eyebrow="04 — Eyebrows" title="Small mono labels with a leading rule.">
        <div className="flex flex-col gap-3">
          <Eyebrow tone="clay">Clay eyebrow · 01</Eyebrow>
          <Eyebrow tone="faint">Faint eyebrow · 02</Eyebrow>
        </div>
      </Section>

      <Section eyebrow="05 — Buttons" title="Pill geometry, restrained motion.">
        <div className="flex flex-wrap items-center gap-4">
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="cta" size="lg">
            Start free
          </Button>
          <Button variant="pinterest">Connect Pinterest</Button>
          <Button variant="primary" size="sm">
            Small
          </Button>
          <Button variant="primary" withArrow>
            With arrow
          </Button>
        </div>
      </Section>

      <Section eyebrow="06 — Pills & palette" title="Tags, statuses, and the palette strip.">
        <div className="flex flex-wrap items-center gap-4">
          <Pill withDot>In stock</Pill>
          <Pill tone="ink">Featured</Pill>
          <Pill tone="olive" withDot dotTone="gold">
            Ships AU
          </Pill>
          <Pill tone="clay">Limited</Pill>
        </div>
        <div className="mt-6">
          <PaletteStrip colors={samplePalette} />
        </div>
      </Section>

      <Section eyebrow="07 — Cards" title="Cream surface on paper.">
        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Living room</CardTitle>
              <CardDescription>Last styled 3 days ago · 8 items · $5,847</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-[14px] text-ink-soft">
                Photo, style and a shoppable picking list, all on one card.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Bedroom</CardTitle>
              <CardDescription>Not styled yet</CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="secondary" size="sm">
                Upload photo
              </Button>
            </CardContent>
          </Card>
        </div>
      </Section>

      <Section eyebrow="08 — Hotspots" title="On-image item markers.">
        <div className="relative aspect-[16/11] max-w-2xl overflow-hidden rounded-lg shadow-soft">
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              background:
                'linear-gradient(160deg, #d8c5a8, #8b6f4e), radial-gradient(circle at 30% 70%, rgba(255,230,200,0.3), transparent 50%)',
            }}
          />
          <Hotspot active position={{ top: '55%', left: '32%' }} label="Sofa hotspot" />
          <Hotspot position={{ top: '70%', left: '60%' }} label="Coffee table hotspot" />
          <Hotspot position={{ top: '30%', left: '78%' }} label="Art hotspot" />
          <Hotspot position={{ top: '40%', left: '15%' }} label="Lamp hotspot" />
        </div>
      </Section>

      <Section eyebrow="09 — Item cards" title="Picking-list rows.">
        <div className="max-w-md space-y-1 rounded-lg border border-ink/[0.06] bg-cream p-4 shadow-soft">
          <ItemCard data={sampleItems[0]!} active />
          <ItemCard data={sampleItems[1]!} />
          <ItemCard data={sampleItems[2]!} />
        </div>
      </Section>

      <Section eyebrow="10 — Form primitives" title="Inputs, labels.">
        <div className="max-w-sm space-y-3">
          <div>
            <Label htmlFor="ds-email">Email</Label>
            <Input id="ds-email" type="email" placeholder="you@example.com" className="mt-2" />
          </div>
          <div>
            <Label htmlFor="ds-pw">Password</Label>
            <Input id="ds-pw" type="password" className="mt-2" />
          </div>
        </div>
      </Section>

      <footer className="mt-24 flex items-center justify-between border-t border-ink/12 pt-6 font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
        <span>saltbush · design system</span>
        <span>v0 · M0 · {new Date().getFullYear()}</span>
      </footer>
    </main>
  );
}

function Section({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-20">
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 className="mt-2 font-display text-2xl font-light tracking-tight text-ink">{title}</h2>
      <div className="mt-8">{children}</div>
    </section>
  );
}
