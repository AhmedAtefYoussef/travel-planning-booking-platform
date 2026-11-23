import type { Route } from 'next';
import Link from 'next/link';
import { PUBLIC_LINKS } from '../model/nav';

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <p>Travel Platform · GIU Software Project I, Winter 2026</p>
        <nav aria-label="Footer" className="flex flex-wrap gap-4">
          {PUBLIC_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href as Route}
              className="hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
