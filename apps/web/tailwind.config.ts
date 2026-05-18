import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    container: {
      center: true,
      padding: {
        DEFAULT: '1rem',
        sm: '1.5rem',
        lg: '3.5rem',
      },
      screens: { '2xl': '1320px' },
    },
    extend: {
      colors: {
        // Saltbush palette. Use these by name; the shadcn aliases below stay
        // wired up so existing primitives keep working.
        paper: {
          DEFAULT: 'hsl(var(--paper))',
          warm: 'hsl(var(--paper-warm))',
          deep: 'hsl(var(--paper-deep))',
        },
        cream: 'hsl(var(--cream))',
        ink: {
          DEFAULT: 'hsl(var(--ink))',
          soft: 'hsl(var(--ink-soft))',
          faint: 'hsl(var(--ink-faint))',
        },
        clay: {
          DEFAULT: 'hsl(var(--clay))',
          soft: 'hsl(var(--clay-soft))',
        },
        olive: 'hsl(var(--olive))',
        gold: 'hsl(var(--gold))',

        // Editorial kit (myhome dashboard brief). Warm luxury palette,
        // used on /dashboard and the nexus surfaces. Hex values are the
        // brief's locked specification.
        editorial: {
          cream: '#FAF7F2', // background
          surface: '#FDFAF6', // cards
          ink: '#2C1F14', // primary text
          taupe: '#8B7355', // secondary text
          cognac: '#C4956A', // accent
          sage: '#4A7A4A', // success
          border: '#E8E0D0', // soft borders
          borderStrong: '#D4C5A9', // hover/active borders
        },

        // shadcn compat
        border: 'hsl(var(--ink) / 0.12)',
        'border-soft': 'hsl(var(--ink) / 0.06)',
        input: 'hsl(var(--ink) / 0.12)',
        ring: 'hsl(var(--clay))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
        pill: '999px',
      },
      fontFamily: {
        // Saltbush kit
        display: ['var(--font-display)', 'Georgia', 'serif'],
        sans: ['var(--font-body)', 'system-ui', 'sans-serif'],
        body: ['var(--font-body)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
        // Editorial kit (dashboard brief)
        serif: ['var(--font-serif)', 'Playfair Display', 'Georgia', 'serif'],
        dmsans: ['var(--font-dmsans)', 'system-ui', 'sans-serif'],
        dmmono: ['var(--font-dmmono)', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        // Editorial scale, see DESIGN-BRIEF §2.
        meta: ['11px', { lineHeight: '1.3', letterSpacing: '0.14em' }],
        price: ['14px', { lineHeight: '1' }],
        'display-3': ['clamp(22px, 2vw, 30px)', { lineHeight: '1.1', letterSpacing: '-0.01em' }],
        'display-2': ['clamp(36px, 4vw, 52px)', { lineHeight: '1.02', letterSpacing: '-0.02em' }],
        'display-1': ['clamp(44px, 5.4vw, 78px)', { lineHeight: '0.98', letterSpacing: '-0.025em' }],
      },
      boxShadow: {
        soft: '0 24px 60px -20px rgba(27, 24, 21, 0.18)',
        card: '0 14px 28px -10px rgba(27, 24, 21, 0.2)',
        pop: '0 8px 24px rgba(27, 24, 21, 0.18)',
      },
      letterSpacing: {
        eyebrow: '0.14em',
        'eyebrow-wide': '0.16em',
      },
      transitionTimingFunction: {
        editorial: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};

export default config;
