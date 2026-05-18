import { cn } from '@/lib/utils';

type TagTone = 'neutral' | 'cognac' | 'sage' | 'taupe';

interface TagProps {
  children: React.ReactNode;
  tone?: TagTone;
  className?: string;
}

const toneClass: Record<TagTone, string> = {
  neutral: 'bg-editorial-surface text-editorial-taupe border-editorial-border',
  cognac: 'bg-[#FBF1E5] text-editorial-cognac border-[#EBD9C0]',
  sage: 'bg-[#E9F0E5] text-editorial-sage border-[#CFE0C6]',
  taupe: 'bg-editorial-surface text-editorial-taupe border-editorial-borderStrong',
};

// Pill-style tag for style hints, status badges, etc. Sentence case.
export function Tag({ children, tone = 'neutral', className }: TagProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-dmmono text-[10px] uppercase tracking-[0.1em]',
        toneClass[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
