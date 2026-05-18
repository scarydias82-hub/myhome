import Link from 'next/link';
import { Logo } from '@/components/saltbush/logo';
import { Eyebrow } from '@/components/saltbush/eyebrow';
import { DisplayHeading } from '@/components/saltbush/display-heading';

export const metadata = {
  title: 'Privacy Policy · myhome',
  description: 'How myhome handles your data, including Pinterest integration.',
};

const LAST_UPDATED = '18 May 2026';
const CONTACT_EMAIL = 'hello@myhome.app';

export default function PrivacyPage() {
  return (
    <>
      <header className="border-b border-ink/[0.06]">
        <div className="container flex items-center justify-between py-6">
          <Logo href="/" size="md" />
          <nav className="hidden gap-6 text-[14px] text-ink-soft md:flex">
            <Link href="/privacy" className="text-ink">Privacy</Link>
            <Link href="/terms" className="hover:text-ink">Terms</Link>
          </nav>
        </div>
      </header>

      <main className="container py-12 md:py-16">
        <div className="mx-auto max-w-3xl space-y-10">
          <div>
            <Eyebrow>Privacy</Eyebrow>
            <DisplayHeading level={2} className="mt-3">
              How we handle your <em>data</em>.
            </DisplayHeading>
            <p className="mt-3 font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
              Last updated · {LAST_UPDATED}
            </p>
          </div>

          <Section title="1. Who we are">
            <p>
              myhome is an Australian interior design platform that helps people visualise their
              rooms restyled and connects them with real Australian retailers. This policy explains
              what data we collect, why we collect it, and what choices you have. Questions:{' '}
              <a className="text-clay hover:underline" href={`mailto:${CONTACT_EMAIL}`}>
                {CONTACT_EMAIL}
              </a>
              .
            </p>
          </Section>

          <Section title="2. What we collect when you sign up">
            <p>
              We collect your email address and authentication tokens through Supabase so you can
              sign in and have a private account. We do not sell or share this information with
              third parties for marketing.
            </p>
          </Section>

          <Section title="3. Room photos you upload">
            <p>
              Photos you upload are stored privately in our cloud storage (Supabase Storage). Only
              you and authenticated server processes acting on your behalf can read them. We use
              them to run vision analysis (Claude Sonnet) and to render restyled versions (fal.ai
              Flux). We do not use your photos to train models or share them with third parties
              outside the rendering pipeline.
            </p>
          </Section>

          <Section title="4. Pinterest integration">
            <p>
              When you connect your Pinterest account, we request read-only access scopes (
              <code className="font-mono text-[13px]">boards:read</code> and{' '}
              <code className="font-mono text-[13px]">pins:read</code>) so that we can read the
              public and private boards you choose to share with us.
            </p>
            <p>
              <strong>We follow Pinterest's developer policy strictly:</strong>
            </p>
            <ul className="list-disc space-y-2 pl-6">
              <li>
                We do <strong>not</strong> store the pins themselves — neither pin images nor pin
                URLs are written to our database.
              </li>
              <li>
                We fetch pins live from Pinterest each time you ask for a fresh analysis, run our
                vision model over them in memory, derive a per-board <em>style profile</em>{' '}
                (style descriptor, palette hex codes, materials, mood), and persist <em>only that
                derived signal</em>. The pins themselves are discarded.
              </li>
              <li>We do not combine your Pinterest data with other users' data.</li>
              <li>
                You can disconnect Pinterest at any time. Disconnecting revokes our access token
                and deletes the stored derived style profile.
              </li>
            </ul>
            <p>
              The Pinterest OAuth access token and refresh token are stored encrypted, accessible
              only to server processes acting on your behalf.
            </p>
          </Section>

          <Section title="5. Products and retailer links">
            <p>
              We maintain a catalogue of products from Australian retailers (Coco Republic, Poliform
              Australia, GlobeWest, and others). Where we link to a product, we may use an
              affiliate-tracking URL that earns us a small commission if you purchase. This costs
              you nothing extra. Where this applies the link is marked accordingly.
            </p>
          </Section>

          <Section title="6. Analytics and error tracking">
            <p>
              We use PostHog for product analytics (anonymised usage patterns — what features are
              used, where users get stuck) and Sentry for error tracking (so we can fix bugs).
              Neither service is used to sell or share your information.
            </p>
          </Section>

          <Section title="7. Third-party services we share data with">
            <p>To deliver the product, we send specific data to:</p>
            <ul className="list-disc space-y-2 pl-6">
              <li>
                <strong>Supabase</strong> (Sydney region) — authentication, database, file storage
              </li>
              <li>
                <strong>fal.ai</strong> — your room photo is sent to fal.ai for Flux rendering and
                object detection. fal.ai processes it transiently and does not retain it long-term
                per their terms.
              </li>
              <li>
                <strong>Anthropic (Claude)</strong> — your room photo and room metadata are sent
                to Claude vision for analysis. Anthropic does not train on API data.
              </li>
              <li>
                <strong>Pinterest</strong> — only authentication and metadata required to access
                the boards you authorise.
              </li>
            </ul>
          </Section>

          <Section title="8. Your rights">
            <p>
              You can request a copy of your data, ask us to delete your account, or revoke any
              third-party connection at any time by emailing{' '}
              <a className="text-clay hover:underline" href={`mailto:${CONTACT_EMAIL}`}>
                {CONTACT_EMAIL}
              </a>
              . We comply with the Australian Privacy Principles under the Privacy Act 1988 (Cth).
            </p>
          </Section>

          <Section title="9. Changes to this policy">
            <p>
              If we change this policy in a material way, we will update the "Last updated" date
              above and notify active users by email. Minor clarifications may be made without
              notification.
            </p>
          </Section>

          <Section title="10. Contact">
            <p>
              Questions or requests:{' '}
              <a className="text-clay hover:underline" href={`mailto:${CONTACT_EMAIL}`}>
                {CONTACT_EMAIL}
              </a>
              .
            </p>
          </Section>
        </div>
      </main>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="font-display text-h3 text-ink">{title}</h2>
      <div className="space-y-3 text-[15px] leading-relaxed text-ink-soft">{children}</div>
    </section>
  );
}
