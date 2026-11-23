'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

import { useAuth } from '@/lib/auth/auth-context';
import { loginUrl } from '@/lib/auth/routes';
import { cn } from '@/lib/cn';
import { SITE_NAME } from '@/lib/seo';

import { PUBLIC_LINKS, ROLE_LINKS, isActive, type NavLink } from './nav-links';

function NavItem({
  link,
  pathname,
  onClick,
}: {
  link: NavLink;
  pathname: string;
  onClick?: () => void;
}) {
  const active = isActive(pathname, link.href);
  return (
    <Link
      href={link.href}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'rounded-md px-3 py-2 text-sm font-medium transition-colors',
        active
          ? 'bg-primary/10 text-primary'
          : 'text-foreground/80 hover:bg-foreground/5 hover:text-foreground',
      )}
    >
      {link.label}
    </Link>
  );
}

/**
 * Global header and navigation (GEN-14): public sections for everyone, plus the signed-in role's
 * own sections. Collapses into a menu on small screens (GEN-16).
 */
export function SiteHeader() {
  const pathname = usePathname();
  const { user, status, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const links = [...PUBLIC_LINKS, ...(user ? ROLE_LINKS[user.role] : [])];
  const close = () => setOpen(false);

  const account =
    status === 'loading' ? (
      <span
        className="bg-foreground/10 h-9 w-24 animate-pulse rounded-md"
        aria-hidden
      />
    ) : user ? (
      <div className="flex items-center gap-2">
        {/* FE-04 (in-app notifications) mounts the bell here. */}
        <div id="notification-bell-slot" />
        <Link
          href="/account"
          onClick={close}
          className="hover:bg-foreground/5 rounded-md px-3 py-2 text-sm font-medium"
        >
          {user.name}
        </Link>
        <button
          type="button"
          onClick={() => void logout()}
          className="border-border hover:bg-foreground/5 rounded-md border px-3 py-2 text-sm font-medium"
        >
          Log out
        </button>
      </div>
    ) : (
      <div className="flex items-center gap-2">
        <Link
          href={loginUrl(pathname)}
          onClick={close}
          className="hover:bg-foreground/5 rounded-md px-3 py-2 text-sm font-medium"
        >
          Log in
        </Link>
        <Link
          href="/register"
          onClick={close}
          className="bg-primary text-primary-foreground hover:bg-primary-hover rounded-md px-3 py-2 text-sm font-medium"
        >
          Sign up
        </Link>
      </div>
    );

  return (
    <header className="border-border bg-surface/95 sticky top-0 z-40 border-b backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link
          href="/"
          className="text-lg font-semibold tracking-tight"
          onClick={close}
        >
          {SITE_NAME}
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          {links.map((link) => (
            <NavItem key={link.href} link={link} pathname={pathname} />
          ))}
        </nav>

        <div className="hidden md:block">{account}</div>

        <button
          type="button"
          className="hover:bg-foreground/5 rounded-md p-2 md:hidden"
          aria-expanded={open}
          aria-controls="mobile-nav"
          aria-label={open ? 'Close menu' : 'Open menu'}
          onClick={() => setOpen((v) => !v)}
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            aria-hidden
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            {open ? (
              <path d="M6 6l12 12M18 6L6 18" />
            ) : (
              <path d="M4 7h16M4 12h16M4 17h16" />
            )}
          </svg>
        </button>
      </div>

      {open && (
        <div
          id="mobile-nav"
          className="border-border border-t px-4 pt-2 pb-4 md:hidden"
        >
          <nav aria-label="Main" className="flex flex-col gap-1">
            {links.map((link) => (
              <NavItem
                key={link.href}
                link={link}
                pathname={pathname}
                onClick={close}
              />
            ))}
          </nav>
          <div className="border-border mt-3 border-t pt-3">{account}</div>
        </div>
      )}
    </header>
  );
}
