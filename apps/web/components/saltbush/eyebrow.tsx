import { cn } from '@/lib/utils';

interface EyebrowProps {
  children: React.ReactNode;
  tone?: 'clay' | 'faint';
  className?: string;
  as?: keyof JSX.IntrinsicElements;
}

export function Eyebrow({ children, tone = 'clay', className, as: Tag = 'p' }: EyebrowProps) {
  const toneClass = tone === 'clay' ? 'text-clay' : 'text-ink-faint';
  const ruleColor = tone === 'clay' ? 'bg-clay' : 'bg-ink-faint';
  return (
    <Tag
      className={cn(
        'inline-flex items-center gap-2.5 font-mono text-meta uppercase',
        toneClass,
        className,
      )}
    >
      <span aria-hidden className={cn('inline-block h-px w-6', ruleColor)} />
      {children}
    </Tag>
  );
}
