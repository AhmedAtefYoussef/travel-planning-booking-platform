'use client';

import { useRouter, useSearchParams } from 'next/navigation';

import { api } from '@/lib/api/client';
import type { LoginResponse } from '@/lib/api/types';
import { useAuth } from '@/lib/auth/auth-context';
import { safeNextPath } from '@/lib/auth/routes';
import { useApiForm } from '@/lib/forms/api-form';

interface LoginValues {
  email: string;
  password: string;
}

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { signedIn } = useAuth();
  const {
    register,
    onSubmit,
    formError,
    formState: { errors, isSubmitting },
  } = useApiForm<LoginValues>({ defaultValues: { email: '', password: '' } });

  const submit = onSubmit(async (values) => {
    const res = await api.post<LoginResponse>('/auth/login', values);
    signedIn(res.user);
    // A temporary password must be changed first; otherwise honour ?next= and fall back to the role home.
    const destination = res.user.mustChangePassword
      ? res.homePath
      : safeNextPath(params.get('next'), res.homePath);
    router.replace(destination);
    router.refresh();
  });

  return (
    <form onSubmit={submit} noValidate className="mt-6 space-y-4">
      {formError && (
        <p
          role="alert"
          className="border-danger/30 bg-danger/10 text-danger rounded-md border px-3 py-2 text-sm"
        >
          {formError}
        </p>
      )}
      <div className="space-y-1">
        <label htmlFor="email" className="text-sm font-medium">
          Email
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          aria-invalid={!!errors.email}
          aria-describedby={errors.email ? 'email-error' : undefined}
          className="border-border bg-surface w-full rounded-md border px-3 py-2"
          {...register('email', { required: 'Enter your email' })}
        />
        {errors.email && (
          <p id="email-error" className="text-danger text-sm">
            {errors.email.message}
          </p>
        )}
      </div>
      <div className="space-y-1">
        <label htmlFor="password" className="text-sm font-medium">
          Password
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          aria-invalid={!!errors.password}
          aria-describedby={errors.password ? 'password-error' : undefined}
          className="border-border bg-surface w-full rounded-md border px-3 py-2"
          {...register('password', { required: 'Enter your password' })}
        />
        {errors.password && (
          <p id="password-error" className="text-danger text-sm">
            {errors.password.message}
          </p>
        )}
      </div>
      <button
        type="submit"
        disabled={isSubmitting}
        className="bg-primary text-primary-foreground hover:bg-primary-hover w-full rounded-md px-4 py-2 font-medium disabled:opacity-60"
      >
        {isSubmitting ? 'Logging in…' : 'Log in'}
      </button>
    </form>
  );
}
