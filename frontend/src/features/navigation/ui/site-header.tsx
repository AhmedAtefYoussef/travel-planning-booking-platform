'use client';

import { Menu, Plane } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { useAuth } from '@/features/auth';
import { ROUTES } from '@/shared/config/routes';
import { Button } from '@/shared/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/shared/ui/sheet';
import { ACCOUNT_LINKS, PUBLIC_LINKS, roleLinks } from '../model/nav';
import { AccountMenu } from './account-menu';
import { NavItem } from './nav-link';

/**
 * Global header (GEN-14, GEN-16): discovery links for everyone, the role's own area once signed in,
 * and a sheet menu on small screens. The session comes from GET /api/auth/me on the client, so the
 * pages under it can stay static or cached (brief section 9).
 */
export function SiteHeader() {
  const { state, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const links = [...PUBLIC_LINKS, ...roleLinks(state.user?.role ?? null)];
  const close = () => setOpen(false);

  return (
    <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-4 px-4">
        <Link
          href={ROUTES.home}
          className="flex items-center gap-2 font-heading text-lg font-semibold tracking-tight"
        >
          <Plane className="size-5 text-primary" aria-hidden="true" />
          Travel Platform
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          {links.map((link) => (
            <NavItem key={link.href} link={link} />
          ))}
        </nav>

        <div className="ml-auto hidden md:block">
          <AccountMenu />
        </div>

        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="ml-auto md:hidden"
              aria-label="Open menu"
            >
              <Menu aria-hidden="true" />
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="w-72">
            <SheetHeader>
              <SheetTitle>Menu</SheetTitle>
              <SheetDescription className="sr-only">
                Site navigation
              </SheetDescription>
            </SheetHeader>
            <nav aria-label="Mobile" className="flex flex-col gap-1 px-4">
              {links.map((link) => (
                <NavItem key={link.href} link={link} onNavigate={close} />
              ))}
              <div className="my-2 border-t" />
              {state.status === 'authenticated' ? (
                <>
                  {ACCOUNT_LINKS.map((link) => (
                    <NavItem key={link.href} link={link} onNavigate={close} />
                  ))}
                  <Button
                    variant="ghost"
                    className="justify-start"
                    onClick={() => {
                      close();
                      void logout();
                    }}
                  >
                    Log out
                  </Button>
                </>
              ) : state.status === 'guest' ? (
                <>
                  <NavItem
                    link={{ href: ROUTES.login, label: 'Log in' }}
                    onNavigate={close}
                  />
                  <NavItem
                    link={{ href: ROUTES.register, label: 'Sign up' }}
                    onNavigate={close}
                  />
                </>
              ) : null}
            </nav>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}
