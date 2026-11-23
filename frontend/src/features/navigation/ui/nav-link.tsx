'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Suspense } from 'react';
import { cn } from '@/shared/lib/utils';
import { isActive, type NavLink } from '../model/nav';

type NavItemProps = {
  link: NavLink;
  className?: string;
  onNavigate?: () => void;
};

/**
 * A header link that marks the current section for sighted and screen-reader users (GEN-14).
 *
 * With Cache Components, `usePathname` suspends on routes whose dynamic params are only known at
 * request time (e.g. /checkout/flight/<id>). The Suspense boundary keeps the header prerendered: the
 * plain link is the fallback, and the active state fills in once the pathname resolves.
 */
export function NavItem(props: NavItemProps) {
  return (
    <Suspense fallback={<NavAnchor {...props} active={false} />}>
      <ActiveNavItem {...props} />
    </Suspense>
  );
}

function ActiveNavItem(props: NavItemProps) {
  return (
    <NavAnchor {...props} active={isActive(usePathname(), props.link.href)} />
  );
}

function NavAnchor({
  link,
  className,
  onNavigate,
  active,
}: NavItemProps & { active: boolean }) {
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
