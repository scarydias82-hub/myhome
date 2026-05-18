import Link from 'next/link';

interface SectionHeaderProps {
  title: string;
  action?: { label: string; href: string };
}

// Section header per the dashboard brief — Playfair serif title, optional
// cognac action link on the right. Sentence case enforced.
export function SectionHeader({ title, action }: SectionHeaderProps) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <h2 className="font-serif text-[22px] font-medium leading-tight text-editorial-ink">
        {title}
      </h2>
      {action ? (
        <Link
          href={action.href}
          className="font-dmsans text-[13px] font-medium text-editorial-cognac transition hover:opacity-70"
        >
          {action.label}
        </Link>
      ) : null}
    </div>
  );
}
