'use client';

import { ChevronDown, LogOut, UserRound } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useAuth } from '@/features/auth';
import { ROUTES } from '@/shared/config/routes';
import { Button } from '@/shared/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu';
import { Skeleton } from '@/shared/ui/skeleton';
import { ACCOUNT_LINKS } from '../model/nav';

/** Right side of the header: sign-in buttons for guests, the account menu for signed-in users. */
export function AccountMenu() {
  const { state, logout } = useAuth();

  if (state.status === 'loading') {
    return <Skeleton className="h-9 w-28" aria-label="Loading your account" />;
  }

  if (state.status === 'guest') {
    return (
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost">
          <Link href={ROUTES.login as Route}>Log in</Link>
        </Button>
        <Button asChild>
          <Link href={ROUTES.register as Route}>Sign up</Link>
        </Button>
      </div>
    );
  }

  const { user } = state;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="max-w-48">
          <UserRound aria-hidden="true" />
          <span className="truncate">{user.name}</span>
          <ChevronDown aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="truncate font-normal text-muted-foreground">
          {user.email}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {ACCOUNT_LINKS.map((link) => (
          <DropdownMenuItem key={link.href} asChild>
            <Link href={link.href as Route}>{link.label}</Link>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void logout()}>
          <LogOut aria-hidden="true" />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
