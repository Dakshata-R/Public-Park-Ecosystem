'use client';

/**
 * Personal settings — profile, password and appearance.
 *
 * Distinct from Administration: this page only ever edits the signed-in
 * user's own record. Role is deliberately read-only here, because a user
 * being able to change their own role would make the whole hierarchy
 * decorative.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTheme } from 'next-themes';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import {
  User as UserIcon, Lock, Palette, Monitor, Moon, Sun, LogOut, Shield,
  Server, CheckCircle2, LogIn,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PageHeader } from '@/components/shared/page-header';
import { useAuth } from '@/components/providers/auth-provider';
import { useParks } from '@/lib/hooks/use-api';
import { authApi } from '@/lib/api/endpoints';
import { ApiError, API_BASE_URL } from '@/lib/api/client';
import { cn } from '@/lib/utils';

const profileSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(120),
  phone: z.string().max(20).optional(),
  park: z.string().optional(),
});

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password'),
    newPassword: z.string().min(8, 'New password must be at least 8 characters').max(128),
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

type ProfileValues = z.infer<typeof profileSchema>;
type PasswordValues = z.infer<typeof passwordSchema>;

const ROLE_DESCRIPTIONS: Record<string, string> = {
  citizen: 'Report issues, log wildlife sightings, and browse public data.',
  ecologist: 'Everything a citizen can do, plus curating species records and verifying sightings.',
  officer: 'Operational duties — incidents, work orders, assets and sensors.',
  admin: 'Full control, including user management and system configuration.',
};

export default function SettingsPage() {
  const { user, signedIn, loading, logout, refresh } = useAuth();
  const { theme, setTheme } = useTheme();
  const { data: parks } = useParks();

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Settings" description="Loading your profile…" icon="Settings" />
      </div>
    );
  }

  if (!signedIn || !user) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Settings"
          description="Sign in to manage your profile and preferences."
          icon="Settings"
        />
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <UserIcon className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">You are not signed in.</p>
            <Button asChild>
              <Link href="/login"><LogIn className="mr-2 h-4 w-4" />Sign in</Link>
            </Button>
          </CardContent>
        </Card>

        <AppearanceCard theme={theme} setTheme={setTheme} mounted={mounted} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Your profile, password and appearance preferences."
        icon="Settings"
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ProfileCard user={user} parks={parks?.items ?? []} onSaved={refresh} />
        <div className="space-y-4">
          <RoleCard role={user.role} />
          <PasswordCard />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <AppearanceCard theme={theme} setTheme={setTheme} mounted={mounted} />
        <ConnectionCard />
      </div>

      <Card className="border-destructive/20">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <p className="text-sm font-medium">Sign out</p>
            <p className="text-xs text-muted-foreground">
              Clears the session token stored in this browser.
            </p>
          </div>
          <Button variant="outline" className="text-destructive" onClick={logout}>
            <LogOut className="mr-2 h-4 w-4" />
            Sign out
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------

function ProfileCard({
  user,
  parks,
  onSaved,
}: {
  user: NonNullable<ReturnType<typeof useAuth>['user']>;
  parks: { id: string; name: string }[];
  onSaved: () => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);

  const form = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    values: {
      name: user.name,
      phone: user.phone ?? '',
      park: typeof user.park === 'object' && user.park ? user.park.id : (user.park ?? '') || '',
    },
  });

  const submit = form.handleSubmit(async (values) => {
    setSaving(true);
    try {
      await authApi.updateMe({ name: values.name, phone: values.phone, park: values.park || null });
      await onSaved();
      toast.success('Profile updated');
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Could not save your profile');
    } finally {
      setSaving(false);
    }
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <UserIcon className="h-5 w-5" />
          Profile
        </CardTitle>
        <CardDescription>{user.email}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="name">Full name</Label>
            <Input id="name" {...form.register('name')} />
            {form.formState.errors.name && (
              <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="phone">Phone</Label>
            <Input id="phone" placeholder="Optional" {...form.register('phone')} />
          </div>

          <div className="space-y-1.5">
            <Label>Home park</Label>
            <Select value={form.watch('park')} onValueChange={(v) => form.setValue('park', v)}>
              <SelectTrigger><SelectValue placeholder="None selected" /></SelectTrigger>
              <SelectContent>
                {parks.map((park) => (
                  <SelectItem key={park.id} value={park.id}>{park.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              The park you are primarily associated with. It does not restrict what you can see.
            </p>
          </div>

          <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
            <p>
              <strong className="text-foreground">{user.contributions}</strong> contributions ·
              member since {new Date(user.createdAt).toLocaleDateString()}
            </p>
          </div>

          <Button type="submit" className="w-full" disabled={saving}>
            {saving ? 'Saving…' : 'Save profile'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function RoleCard({ role }: { role: string }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Shield className="h-5 w-5" />
          Your role
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <Badge variant="outline" className="capitalize">{role}</Badge>
        <p className="text-sm text-muted-foreground">{ROLE_DESCRIPTIONS[role]}</p>
        <p className="text-[11px] text-muted-foreground">
          Roles are granted by an administrator and cannot be changed here — self-assignment would
          make the permission hierarchy decorative.
        </p>
      </CardContent>
    </Card>
  );
}

function PasswordCard() {
  const [saving, setSaving] = useState(false);
  // Failures that are not about the current password (network, rate limit,
  // server) belong to the form as a whole, not to one field.
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<PasswordValues>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  const submit = form.handleSubmit(async (values) => {
    setSaving(true);
    setFormError(null);
    try {
      await authApi.changePassword({
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      form.reset();
      toast.success('Password changed');
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'Could not change your password';
      if (error instanceof ApiError && error.status === 400 && /current password is incorrect/i.test(error.message)) {
        form.setError('currentPassword', { message });
      } else if (error instanceof ApiError && error.status === 422 && error.details) {
        // Server-side validation maps back onto the matching inputs.
        for (const [field, detail] of Object.entries(error.details)) {
          if (field === 'currentPassword' || field === 'newPassword') form.setError(field, { message: detail });
          else setFormError(detail);
        }
      } else {
        setFormError(message);
      }
      // An expired session is announced once by AuthProvider.
      if (!(error instanceof ApiError && error.isAuthError)) toast.error(message);
    } finally {
      setSaving(false);
    }
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Lock className="h-5 w-5" />
          Password
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="currentPassword">Current password</Label>
            <Input id="currentPassword" type="password" autoComplete="current-password" {...form.register('currentPassword')} />
            {form.formState.errors.currentPassword && (
              <p className="text-xs text-destructive">{form.formState.errors.currentPassword.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="newPassword">New password</Label>
            <Input id="newPassword" type="password" autoComplete="new-password" {...form.register('newPassword')} />
            {form.formState.errors.newPassword && (
              <p className="text-xs text-destructive">{form.formState.errors.newPassword.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="confirmPassword">Confirm new password</Label>
            <Input id="confirmPassword" type="password" autoComplete="new-password" {...form.register('confirmPassword')} />
            {form.formState.errors.confirmPassword && (
              <p className="text-xs text-destructive">{form.formState.errors.confirmPassword.message}</p>
            )}
          </div>

          {formError && (
            <Alert className="border-destructive/30 bg-destructive/5">
              <AlertDescription className="text-xs text-destructive">{formError}</AlertDescription>
            </Alert>
          )}

          <Button type="submit" variant="outline" className="w-full" disabled={saving}>
            {saving ? 'Changing…' : 'Change password'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function AppearanceCard({
  theme,
  setTheme,
  mounted,
}: {
  theme: string | undefined;
  setTheme: (t: string) => void;
  mounted: boolean;
}) {
  const options = [
    { value: 'light', label: 'Light', icon: Sun },
    { value: 'dark', label: 'Dark', icon: Moon },
    { value: 'system', label: 'System', icon: Monitor },
  ];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Palette className="h-5 w-5" />
          Appearance
        </CardTitle>
        <CardDescription>Applies to this browser only</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-2">
          {options.map((option) => {
            // next-themes resolves on the client, so the active state must not
            // be rendered until after mount or hydration mismatches.
            const active = mounted && theme === option.value;
            return (
              <button
                key={option.value}
                onClick={() => setTheme(option.value)}
                className={cn(
                  'flex flex-col items-center gap-2 rounded-lg border py-4 transition-colors',
                  active ? 'border-primary bg-primary/5' : 'hover:bg-muted'
                )}
              >
                <option.icon className={cn('h-5 w-5', active ? 'text-primary' : 'text-muted-foreground')} />
                <span className="text-xs font-medium">{option.label}</span>
                {active && <CheckCircle2 className="h-3 w-3 text-primary" />}
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Which API this build is talking to.
 *
 * Worth surfacing during a demonstration: "the frontend is pointed at this
 * backend" is the single most common thing to get wrong when running the two
 * halves separately.
 */
function ConnectionCard() {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Server className="h-5 w-5" />
          API connection
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="rounded-lg bg-muted p-3">
          <p className="text-[11px] text-muted-foreground">Backend base URL</p>
          <code className="text-xs">{API_BASE_URL}</code>
        </div>

        {/* Setup guidance is for developers running the two halves locally;
            a deployed build has its API URL baked in and must not mention localhost. */}
        {process.env.NODE_ENV !== 'production' && (
          <Alert className="border-dashed">
            <AlertDescription className="text-[11px] leading-relaxed">
              Set <code className="rounded bg-muted px-1">NEXT_PUBLIC_API_URL</code> in
              <code className="mx-1 rounded bg-muted px-1">frontend/.env.local</code> to point at a
              different backend. Without it, development builds assume the API is running locally on
              port 5000.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
