'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2, LogIn, ShieldCheck, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useAuth } from '@/components/providers/auth-provider';
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
 * Listing them on the sign-in screen is a deliberate choice for a university
 * prototype: an assessor opening this project needs to see all four permission
 * levels without being handed a separate credentials sheet. A real deployment
 * would obviously not do this.
 */
const DEMO_ACCOUNTS = [
  { role: 'Administrator', email: 'admin@greenpulse.gov', detail: 'Full control — users, settings, audit log' },
  { role: 'Ecologist', email: 'ecologist@greenpulse.gov', detail: 'Curates species records and verifies sightings' },
  { role: 'Park Officer', email: 'officer@greenpulse.gov', detail: 'Incidents, work orders, assets, sensors' },
  { role: 'Citizen', email: 'citizen@greenpulse.gov', detail: 'Reports issues and logs wildlife sightings' },
];

const DEMO_PASSWORD = 'greenpulse123';

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
  const { login } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [submitting, setSubmitting] = useState(false);

  // Preserve where the user was heading before being bounced to sign-in.
  const redirectTo = searchParams.get('next') || '/dashboard';

  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = async (values: LoginValues) => {
    setSubmitting(true);
    try {
      const user = await login(values.email, values.password);
      toast.success(`Welcome back, ${user.name.split(' ')[0]}`);
      router.push(redirectTo);
    } catch (error) {
      const message =
        error instanceof ApiError ? error.message : 'Sign-in failed. Please try again.';
      // Attach the error to the form rather than only toasting it, so it
      // stays visible while the user corrects the field.
      form.setError('password', { message });
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  /** One-click sign-in for a demonstration account. */
  const useDemoAccount = (email: string) => {
    form.setValue('email', email);
    form.setValue('password', DEMO_PASSWORD);
    void form.handleSubmit(onSubmit)();
  };

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="font-display text-2xl font-bold tracking-tight">Sign in</h1>
        <p className="text-sm text-muted-foreground">
          Access the operational modules. Dashboards and the biodiversity map are
          public and need no account.
        </p>
      </div>

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

      <div className="relative">
        <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
        <div className="relative flex justify-center text-[11px] uppercase tracking-wider">
          <span className="bg-background px-2 text-muted-foreground">Demonstration accounts</span>
        </div>
      </div>

      <Alert className="border-primary/20 bg-primary/5">
        <ShieldCheck className="h-4 w-4 text-primary" />
        <AlertDescription className="text-xs">
          All four use the password <code className="rounded bg-muted px-1 py-0.5 font-mono">{DEMO_PASSWORD}</code>.
          Click one to sign in and see how the interface changes with permission level.
        </AlertDescription>
      </Alert>

      <div className="space-y-1.5">
        {DEMO_ACCOUNTS.map((account) => (
          <button
            key={account.email}
            type="button"
            onClick={() => useDemoAccount(account.email)}
            disabled={submitting}
            className="group flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors hover:border-primary/40 hover:bg-primary/5 disabled:opacity-50"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{account.role}</p>
              <p className="truncate text-[11px] text-muted-foreground">{account.detail}</p>
            </div>
            <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
          </button>
        ))}
      </div>

      <p className="text-center text-sm text-muted-foreground">
        No account?{' '}
        <Link href="/register" className="font-medium text-primary hover:underline">
          Register as a citizen
        </Link>
      </p>
    </div>
  );
}
