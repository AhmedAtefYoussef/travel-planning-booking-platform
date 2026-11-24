'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ROUTES } from '@/shared/config/routes';
import { cn } from '@/shared/lib/utils';

const BASE = ROUTES.airlineDashboard;
const TABS = [
  { href: BASE, label: 'Airline', exact: true },
  { href: `${BASE}/flights`, label: 'Flights', exact: false },
  { href: `${BASE}/policies`, label: 'Policies', exact: false },
] as const;

/** The three areas of the airline dashboard, always one click away (GEN-15). */
export function DashboardNav() {
  const path = usePathname();
  return (
    <nav aria-label="Airline dashboard" className="border-b">
      <ul className="flex gap-1 overflow-x-auto">
        {TABS.map((tab) => {
          const active = tab.exact
            ? path === tab.href
            : path.startsWith(tab.href);
          return (
            <li key={tab.href}>
              <Link
                href={tab.href as Route}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  '-mb-px inline-flex h-10 items-center border-b-2 px-3 text-sm font-medium whitespace-nowrap',
                  active
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
