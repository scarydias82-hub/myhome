import { cn } from '@/lib/utils';

type Level = 1 | 2 | 3;

interface DisplayHeadingProps {
  level?: Level;
  as?: keyof JSX.IntrinsicElements;
  children: React.ReactNode;
  className?: string;
}

const sizeClass: Record<Level, string> = {
  1: 'text-display-1',
  2: 'text-display-2',
  3: 'text-display-3',
};

const weightClass: Record<Level, string> = {
  1: 'font-light',
  2: 'font-light',
  3: 'font-normal',
};

/**
 * Editorial display heading. Use `<em>` inside `children` to highlight a word
 * in italic clay — the design system's signature pull-quote treatment.
 *
 * Example: <DisplayHeading level={1}>Your room, styled like a <em>magazine</em>.</DisplayHeading>
 */
export function DisplayHeading({ level = 1, as, children, className }: DisplayHeadingProps) {
  const Tag = (as ?? (`h${level}` as keyof JSX.IntrinsicElements)) as keyof JSX.IntrinsicElements;
  return (
    <Tag
      className={cn(
        'font-display text-ink [&_em]:font-light [&_em]:italic [&_em]:text-clay',
        sizeClass[level],
        weightClass[level],
        className,
      )}
    >
      {children}
    </Tag>
  );
}
