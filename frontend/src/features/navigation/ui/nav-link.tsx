'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/shared/lib/utils';
import { isActive, type NavLink } from '../model/nav';

/** A header link that marks the current section for sighted and screen-reader users (GEN-14). */
export function NavItem({
  link,
  className,
  onNavigate,
}: {
  link: NavLink;
  className?: string;
  onNavigate?: () => void;
}) {
  const active = isActive(usePathname(), link.href);
  return (
    <Link
      href={link.href as Route}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
        active && 'bg-secondary text-secondary-foreground',
        className,
      )}
    >
      {link.label}
    </Link>
  );
}
