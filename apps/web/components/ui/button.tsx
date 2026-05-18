import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-colors ease-editorial focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        // Saltbush primary — ink pill, cream text, clay on hover
        primary:
          'rounded-pill bg-ink text-cream hover:bg-clay shadow-sm',
        // Saltbush secondary — transparent with line border, fills ink on hover
        secondary:
          'rounded-pill border border-ink/15 bg-transparent text-ink hover:bg-ink hover:text-cream',
        // CTA — large ink pill with cream circular arrow
        cta: 'rounded-pill bg-ink text-cream hover:bg-clay hover:-translate-y-0.5 shadow-card transition-all duration-300',
        // Pinterest — brand red
        pinterest:
          'rounded-pill bg-[#E60023] text-white hover:brightness-105 shadow-card font-semibold',
        // shadcn-compat aliases for older call sites
        default: 'rounded-pill bg-ink text-cream hover:bg-clay shadow-sm',
        destructive: 'rounded-pill bg-destructive text-destructive-foreground hover:bg-destructive/90',
        outline:
          'rounded-pill border border-ink/15 bg-transparent text-ink hover:bg-ink hover:text-cream',
        ghost: 'rounded-pill text-ink hover:bg-ink/5',
        link: 'text-clay underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-9 px-4 text-[13px]',
        md: 'h-11 px-5 text-[14px]',
        lg: 'h-[52px] px-7 text-[15px]',
        // Match shadcn defaults
        default: 'h-11 px-5 text-[14px]',
        icon: 'h-11 w-11',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  withArrow?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, withArrow = false, children, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    const showArrow = withArrow || variant === 'cta';
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props}>
        {asChild ? (
          children
        ) : (
          <>
            {children}
            {showArrow ? (
              <span
                aria-hidden
                className="inline-flex h-[18px] w-[18px] items-center justify-center rounded-full bg-cream text-ink"
              >
                <ArrowUpRight className="h-3 w-3" strokeWidth={1.75} />
              </span>
            ) : null}
          </>
        )}
      </Comp>
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
