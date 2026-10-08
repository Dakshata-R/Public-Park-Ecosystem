'use client';

import { firstName } from '@/lib/utils';
import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2, LogIn, ArrowRight, WifiOff } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useAuth, safeRedirectPath } from '@/components/providers/auth-provider';
import { ApiError } from '@/lib/api/client';

/** Mirrors the server's `auth.login` schema, so both sides reject the same input. */
const loginSchema = z.object({
  email: z.string().min(1, 'Email is required').email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

type LoginValues = z.infer<typeof loginSchema>;

/**
 * The seeded demonstration accounts.
 *
 * Listing them on the sign-in screen lets an assessor try all four permission
 * levels without a separate credentials sheet — but only when the build opts
 * in with `NEXT_PUBLIC_SHOW_DEMO_ACCOUNTS=true` (set in a local `.env.local`).
 * A deployed build leaves it unset, so the credentials are never published.
 */
const SHOW_DEMO_ACCOUNTS = process.env.NEXT_PUBLIC_SHOW_DEMO_ACCOUNTS === 'true';

// Folded to empty values at build time when the flag is off, so the
// credentials do not ship in the bundle either.
const DEMO_ACCOUNTS = SHOW_DEMO_ACCOUNTS ? [
  { role: 'Administrator', email: 'admin@greenpulse.gov', detail: 'Full control — users, settings, audit log' },
  { role: 'Ecologist', email: 'ecologist@greenpulse.gov', detail: 'Curates species records and verifies sightings' },
  { role: 'Park Officer', email: 'officer@greenpulse.gov', detail: 'Incidents, work orders, assets, sensors' },
  { role: 'Citizen', email: 'citizen@greenpulse.gov', detail: 'Reports issues and logs wildlife sightings' },
] : [];

const DEMO_PASSWORD = SHOW_DEMO_ACCOUNTS ? 'greenpulse123' : '';

/**
 * `useSearchParams()` opts a route out of static rendering unless it is read
 * inside a Suspense boundary, so the form lives in its own component and the
 * page shell stays prerenderable.
 */
export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const { login, sessionError } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [submitting, setSubmitting] = useState(false);

  // Preserve where the user was heading before being bounced to sign-in —
  // but only to a path on this site, never an absolute URL from the query.
  const next = searchParams.get('next');
  const redirectTo = safeRedirectPath(next);

  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = async (values: LoginValues) => {
    setSubmitting(true);
    try {
      const user = await login(values.email, values.password);
      toast.success(`Welcome back, ${firstName(user.name)}`);
      router.push(redirectTo);
    } catch (error) {
      const message =
        error instanceof ApiError ? error.message : 'Sign-in failed. Please try again.';
      // Attach a credentials error to the form rather than only toasting it,
      // so it stays visible while the user corrects the field. A network or
      // server failure is not the password's fault and is only toasted.
      if (error instanceof ApiError && error.status >= 400 && error.status < 500 && !error.isRateLimited) {
        form.setError('password', { message });
      }
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  /** One-click sign-in for a demonstration account. */
  const signInAsDemo = (email: string) => {
    form.setValue('email', email);
    form.setValue('password', DEMO_PASSWORD);
    void form.handleSubmit(onSubmit)();
  };

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="font-display text-2xl font-bold tracking-tight">Sign in</h1>
        <p className="text-sm text-muted-foreground">
          Welcome back. Sign in to continue.
        </p>
      </div>

      {sessionError && (
        <Alert className="border-warning/30 bg-warning/5">
          <WifiOff className="h-4 w-4 text-warning" />
          <AlertDescription className="text-xs">
            Your saved session could not be checked because the server did not respond. You may still
            be signed in — try again once the connection is back, or sign in below.
          </AlertDescription>
        </Alert>
      )}

      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="email">Email address</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="you@greenpulse.gov"
            {...form.register('email')}
            aria-invalid={Boolean(form.formState.errors.email)}
          />
          {form.formState.errors.email && (
            <p className="text-xs text-destructive">{form.formState.errors.email.message}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            placeholder="••••••••"
            {...form.register('password')}
            aria-invalid={Boolean(form.formState.errors.password)}
          />
          {form.formState.errors.password && (
            <p className="text-xs text-destructive">{form.formState.errors.password.message}</p>
          )}
        </div>

        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? (
            <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Signing in…</>
          ) : (
            <><LogIn className="mr-2 h-4 w-4" />Sign in</>
          )}
        </Button>
      </form>

      {SHOW_DEMO_ACCOUNTS && (
        <>
          <div className="relative">
            <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
            <div className="relative flex justify-center text-[11px] uppercase tracking-wider">
              <span className="bg-background px-2 text-muted-foreground">Or sign in as</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {DEMO_ACCOUNTS.map((account) => (
              <button
                key={account.email}
                type="button"
                onClick={() => signInAsDemo(account.email)}
                disabled={submitting}
                title={account.detail}
                className="group flex items-center justify-between rounded-lg border px-3 py-2 text-sm font-medium transition-colors hover:border-primary/40 hover:bg-primary/5 disabled:opacity-50"
              >
                {account.role}
                <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
              </button>
            ))}
          </div>

          <p className="text-center text-xs text-muted-foreground">
            Demo password: <code className="rounded bg-muted px-1 py-0.5 font-mono">{DEMO_PASSWORD}</code>
          </p>
        </>
      )}

      <p className="text-center text-sm text-muted-foreground">
        No account?{' '}
        <Link
          href={next ? `/register?next=${encodeURIComponent(redirectTo)}` : '/register'}
          className="font-medium text-primary hover:underline"
        >
          Register as a citizen
        </Link>
      </p>
    </div>
  );
}
