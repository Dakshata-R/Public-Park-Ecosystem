'use client';

/**
 * Module 12 — Administration.
 *
 * The consequential control here is the health-index weight editor. Those five
 * numbers determine every ecosystem score in the system, so the form validates
 * that they sum to 1 before saving and triggers a full recompute afterwards —
 * a silent partial update would leave parks scored under two different
 * formulas at once.
 */

import { useState } from 'react';
import {
  Shield, Users, ScrollText, Activity, Plus, Pencil, Trash2,
  RefreshCw, Database, TriangleAlert, Globe2, CheckCircle2, XCircle, Eraser,
} from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { PageHeader } from '@/components/shared/page-header';
import { DataTable } from '@/components/shared/data-table';
import { FilterBar } from '@/components/shared/filter-bar';
import { Pagination } from '@/components/shared/pagination';
import { MetricTile } from '@/components/shared/score-badge';
import { QueryState, SkeletonCards, LoadingState, ErrorState } from '@/components/shared/query-state';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { SourceBadge } from '@/components/shared/data-source';
import { useAuth } from '@/components/providers/auth-provider';
import {
  useUsers, useAuditLog, useSystemStats, useParks, useIntegrationStatus,
  useCreateUser, useUpdateUser, useDeleteUser,
  useRecomputeScores, useReindexAssistant, useReseed, useClearIntegrationCache,
} from '@/lib/hooks/use-api';
import { cn } from '@/lib/utils';
import type { AuditEntry, User, UserRole } from '@/lib/types';

const ROLES: UserRole[] = ['citizen', 'ecologist', 'officer', 'admin'];

const ROLE_TONE: Record<UserRole, string> = {
  admin: 'bg-destructive/15 text-destructive border-destructive/30',
  officer: 'bg-warning/15 text-warning border-warning/30',
  ecologist: 'bg-info/15 text-info border-info/30',
  citizen: 'bg-secondary text-secondary-foreground border-border',
};

/** Radix Select cannot hold an empty value, so "no home park" needs a sentinel. */
const NO_PARK = 'none';

/**
 * A new account needs a password; an edit may leave it blank to keep the
 * current one. Either way a supplied password must meet the server's minimum.
 */
const userSchema = (editing: boolean) =>
  z
    .object({
      name: z.string().min(2, 'Name is required').max(120),
      email: z.string().email('Enter a valid email address'),
      password: z.string().max(128, 'Password must be at most 128 characters'),
      role: z.enum(['citizen', 'ecologist', 'officer', 'admin']),
      park: z.string(),
      active: z.boolean(),
    })
    .superRefine((values, ctx) => {
      if (!values.password && editing) return;
      if (values.password.length < 8) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['password'],
          message: values.password ? 'Password must be at least 8 characters' : 'A password is required',
        });
      }
    });

type UserValues = z.infer<ReturnType<typeof userSchema>>;

export default function AdminPage() {
  const { can, user, loading } = useAuth();

  // Until the stored session has been checked, "not signed in" is not yet known.
  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Administration" description="Checking your access…" icon="Shield" />
        <LoadingState label="Checking your access…" />
      </div>
    );
  }

  // The whole module is admin-only; the API enforces the same, but showing a
  // clear message beats letting every panel fail with 403.
  if (!can('admin')) {
    return (
      <div className="space-y-6">
        <PageHeader title="Administration" description="Restricted area." icon="Shield" />
        <Alert className="border-destructive/20 bg-destructive/5">
          <Shield className="h-4 w-4 text-destructive" />
          <AlertDescription className="text-sm">
            Administration requires the <strong>admin</strong> role.
            {user ? ` You are signed in as ${user.role}.` : ' You are not signed in.'}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Administration"
        description="User accounts, the audit trail and platform maintenance."
        icon="Shield"
      />

      <Tabs defaultValue="users" className="space-y-4">
        <TabsList className="grid w-full grid-cols-3 sm:w-auto">
          <TabsTrigger value="users"><Users className="mr-1.5 h-3.5 w-3.5" />Users</TabsTrigger>
          <TabsTrigger value="audit"><ScrollText className="mr-1.5 h-3.5 w-3.5" />Audit log</TabsTrigger>
          <TabsTrigger value="system"><Activity className="mr-1.5 h-3.5 w-3.5" />System</TabsTrigger>
        </TabsList>

        <TabsContent value="users"><UsersTab /></TabsContent>
        <TabsContent value="audit"><AuditTab /></TabsContent>
        <TabsContent value="system"><SystemTab /></TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

function UsersTab() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('all');

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [deleting, setDeleting] = useState<User | null>(null);

  const query = useUsers({
    page, limit: 15,
    q: search || undefined,
    role: role === 'all' ? undefined : role,
    // Deactivating an account archives it rather than erasing it, and this
    // screen is where that state is shown and reversed — so it has to list
    // archived accounts too. Pickers elsewhere (assigning an officer to an
    // incident, say) deliberately keep the default and omit them.
    includeArchived: true,
  });
  const deleteUser = useDeleteUser();

  const columns = [
    {
      key: 'name',
      header: 'User',
      render: (row: User) => (
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="truncate font-medium">{row.name}</p>
            {row.demo && <SourceBadge source="demo" className="px-1.5 py-0 text-[10px]" />}
          </div>
          <p className="truncate text-[11px] text-muted-foreground">{row.email}</p>
        </div>
      ),
    },
    {
      key: 'role',
      header: 'Role',
      render: (row: User) => (
        <Badge variant="outline" className={cn('capitalize', ROLE_TONE[row.role])}>{row.role}</Badge>
      ),
    },
    {
      key: 'park',
      header: 'Home park',
      render: (row: User) => (
        <span className="text-muted-foreground">
          {typeof row.park === 'object' && row.park ? row.park.name : '—'}
        </span>
      ),
    },
    {
      key: 'contributions',
      header: 'Contributions',
      render: (row: User) => <span className="tabular-nums">{row.contributions}</span>,
    },
    {
      key: 'active',
      header: 'Status',
      render: (row: User) =>
        row.active ? (
          <Badge variant="outline" className="border-success/30 bg-success/10 text-[10px] text-success">Active</Badge>
        ) : (
          <Badge variant="outline" className="text-[10px]">Deactivated</Badge>
        ),
    },
    {
      key: 'lastLoginAt',
      header: 'Last seen',
      render: (row: User) => (
        <span className="text-muted-foreground">
          {row.lastLoginAt ? new Date(row.lastLoginAt).toLocaleDateString() : 'Never'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      className: 'w-[90px]',
      render: (row: User) => (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditing(row)} aria-label={`Edit ${row.name}`}>
            <Pencil className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setDeleting(row)} aria-label={`Deactivate ${row.name}`}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <FilterBar
          search={search}
          onSearch={(v) => { setSearch(v); setPage(1); }}
          searchPlaceholder="Search by name or email…"
          filters={[
            {
              label: 'Role',
              value: role,
              onChange: (v) => { setRole(v); setPage(1); },
              options: [{ label: 'All roles', value: 'all' }, ...ROLES.map((r) => ({ label: r, value: r }))],
            },
          ]}
        />
        <Button onClick={() => setCreating(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Add user
        </Button>
      </div>

      <Alert className="border-dashed">
        <Shield className="h-4 w-4" />
        <AlertDescription className="text-xs">
          Roles form a hierarchy — <strong>citizen → ecologist → officer → admin</strong> — so an
          officer route also admits admins. Public registration always creates a citizen; elevated
          roles can only be granted here.
        </AlertDescription>
      </Alert>

      <QueryState
        query={query}
        isEmpty={(data) => data.items.length === 0}
        emptyTitle="No users match those filters"
        emptyIcon="Users"
        skeleton={<LoadingState label="Loading users…" />}
      >
        {(data) => (
          <>
            <DataTable columns={columns} data={data.items} rowKey={(row) => row.id} />
            <Pagination meta={data.meta} onPageChange={setPage} />
          </>
        )}
      </QueryState>

      <UserFormDialog
        open={creating || Boolean(editing)}
        user={editing}
        onClose={() => { setCreating(false); setEditing(null); }}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Deactivate ${deleting?.name}?`}
        description="The account is marked inactive rather than erased, so their reports, observations and audit entries stay attributed."
        confirmLabel="Deactivate"
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await deleteUser.mutateAsync(deleting.id);
          } catch {
            /* toast already shown */
          }
        }}
      />
    </div>
  );
}

function UserFormDialog({ open, user, onClose }: { open: boolean; user: User | null; onClose: () => void }) {
  const { data: parks } = useParks();
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();

  const form = useForm<UserValues>({
    resolver: zodResolver(userSchema(Boolean(user))),
    values: user
      ? {
          name: user.name,
          email: user.email,
          password: '',
          role: user.role,
          park: (typeof user.park === 'object' && user.park ? user.park.id : user.park) || NO_PARK,
          active: user.active,
        }
      : { name: '', email: '', password: '', role: 'citizen', park: NO_PARK, active: true },
  });

  const close = () => {
    form.reset();
    onClose();
  };

  const submit = form.handleSubmit(async (values) => {
    const payload = {
      name: values.name,
      email: values.email,
      role: values.role,
      park: values.park === NO_PARK ? null : values.park,
      active: values.active,
    };

    try {
      if (user) {
        // An empty password field means "leave it unchanged", not "blank it".
        await updateUser.mutateAsync({
          id: user.id,
          body: values.password ? { ...payload, password: values.password } : payload,
        });
      } else {
        await createUser.mutateAsync({ ...payload, password: values.password });
      }
      close();
    } catch {
      /* toast already shown; keep the dialog open so the input is not lost */
    }
  });

  const pending = createUser.isPending || updateUser.isPending;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{user ? 'Edit user' : 'Add a user'}</DialogTitle>
          <DialogDescription>
            {user
              ? 'Leave the password blank to keep the current one; a new password needs at least 8 characters.'
              : 'Set a password of at least 8 characters and share it with the user securely.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="name">Name</Label>
            <Input id="name" {...form.register('name')} />
            {form.formState.errors.name && (
              <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" {...form.register('email')} />
            {form.formState.errors.email && (
              <p className="text-xs text-destructive">{form.formState.errors.email.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="password">{user ? 'New password (optional)' : 'Password'}</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              placeholder="At least 8 characters"
              aria-invalid={Boolean(form.formState.errors.password)}
              {...form.register('password')}
            />
            {form.formState.errors.password && (
              <p className="text-xs text-destructive">{form.formState.errors.password.message}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select value={form.watch('role')} onValueChange={(v) => form.setValue('role', v as UserRole)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r} value={r} className="capitalize">{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Home park</Label>
              <Select value={form.watch('park')} onValueChange={(v) => form.setValue('park', v)}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_PARK}>None</SelectItem>
                  {parks?.items.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <Label htmlFor="active">Account active</Label>
              <p className="text-[11px] text-muted-foreground">Deactivated users cannot sign in</p>
            </div>
            <Switch
              id="active"
              checked={form.watch('active')}
              onCheckedChange={(v) => form.setValue('active', v)}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>Cancel</Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : user ? 'Save changes' : 'Create user'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

/** Every action the backend records (`AUDIT_ACTIONS` in models/AuditLog.js). */
const AUDIT_ACTIONS: Record<string, { label: string; past: string; tone: string }> = {
  create: { label: 'Create', past: 'created', tone: 'border-success/30 bg-success/10 text-success' },
  update: { label: 'Update', past: 'updated', tone: 'border-info/30 bg-info/10 text-info' },
  delete: { label: 'Delete', past: 'deleted', tone: 'border-destructive/30 bg-destructive/10 text-destructive' },
  login: { label: 'Sign-in', past: 'signed in', tone: 'border-border bg-secondary text-secondary-foreground' },
  logout: { label: 'Sign-out', past: 'signed out', tone: 'border-border bg-secondary text-secondary-foreground' },
  assign: { label: 'Assign', past: 'assigned', tone: 'border-warning/30 bg-warning/10 text-warning' },
  resolve: { label: 'Resolve', past: 'resolved', tone: 'border-success/30 bg-success/10 text-success' },
  seed: { label: 'Reseed', past: 'reseeded', tone: 'border-border bg-secondary text-secondary-foreground' },
};

const AUDIT_ENTITIES = [
  'Incident', 'Asset', 'User', 'CitizenReport', 'WorkOrder', 'Setting', 'Park',
  'Species', 'Observation', 'Sensor', 'AiDetection', 'EcoReport', 'Database',
];

/** "CitizenReport" → "citizen report". */
const entityName = (entity: string) => entity.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();

/** One readable sentence per entry: "signed in", "reseeded the database", "updated incident". */
function describeAudit(entry: AuditEntry) {
  const action = AUDIT_ACTIONS[entry.action];
  if (entry.action === 'login' || entry.action === 'logout') return action.past;
  if (entry.action === 'seed') return `${action.past} the ${entityName(entry.entity || 'Database')}`;
  return `${action?.past ?? entry.action} ${entityName(entry.entity)}`;
}

function AuditTab() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('all');
  const [entity, setEntity] = useState('all');

  const query = useAuditLog({
    page, limit: 25,
    action: action === 'all' ? undefined : action,
    entity: entity === 'all' ? undefined : entity,
  });

  return (
    <div className="space-y-4">
      <FilterBar
        filters={[
          {
            label: 'Action',
            value: action,
            onChange: (v) => { setAction(v); setPage(1); },
            options: [
              { label: 'All actions', value: 'all' },
              ...Object.entries(AUDIT_ACTIONS).map(([value, a]) => ({ label: a.label, value })),
            ],
          },
          {
            label: 'Entity',
            value: entity,
            onChange: (v) => { setEntity(v); setPage(1); },
            options: [
              { label: 'All entities', value: 'all' },
              ...AUDIT_ENTITIES.map((e) => ({ label: e, value: e })),
            ],
          },
        ]}
      />

      <Alert className="border-dashed">
        <ScrollText className="h-4 w-4" />
        <AlertDescription className="text-xs">
          Append-only. Sign-ins and every create, update and delete write one entry with the changed
          fields — municipal systems need to answer &ldquo;who changed this and when&rdquo;, and
          corrections are new entries rather than edits.
        </AlertDescription>
      </Alert>

      <QueryState
        query={query}
        isEmpty={(data) => data.items.length === 0}
        emptyTitle="No audit entries"
        emptyIcon="ScrollText"
        skeleton={<LoadingState label="Loading audit log…" />}
      >
        {(data) => (
          <>
            <div className="space-y-2">
              {data.items.map((entry) => (
                <Card key={entry.id}>
                  <CardContent className="flex flex-wrap items-start gap-3 p-3.5">
                    <Badge variant="outline" className={cn('shrink-0 text-[10px]', AUDIT_ACTIONS[entry.action]?.tone)}>
                      {AUDIT_ACTIONS[entry.action]?.label ?? entry.action}
                    </Badge>

                    <div className="min-w-0 flex-1">
                      <p className="text-sm">
                        <span className="font-medium">{entry.actorName || 'System'}</span>
                        {entry.actorRole && <span className="text-muted-foreground"> ({entry.actorRole})</span>}{' '}
                        {describeAudit(entry)}
                        {entry.entityLabel && <span className="text-muted-foreground"> — {entry.entityLabel}</span>}
                      </p>

                      {Object.keys(entry.changes ?? {}).length > 0 && (
                        <div className="mt-1.5 space-y-0.5">
                          {Object.entries(entry.changes).slice(0, 4).map(([field, change]) => (
                            <p key={field} className="font-mono text-[10px] text-muted-foreground">
                              {field}: {JSON.stringify(change.from)} → {JSON.stringify(change.to)}
                            </p>
                          ))}
                        </div>
                      )}
                    </div>

                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {new Date(entry.createdAt).toLocaleString()}
                    </span>
                  </CardContent>
                </Card>
              ))}
            </div>
            <Pagination meta={data.meta} onPageChange={setPage} />
          </>
        )}
      </QueryState>
    </div>
  );
}

// ---------------------------------------------------------------------------
// System
// ---------------------------------------------------------------------------

function SystemTab() {
  const stats = useSystemStats();
  const integrations = useIntegrationStatus();

  const recompute = useRecomputeScores();
  const reindex = useReindexAssistant();
  const reseed = useReseed();
  const clearCache = useClearIntegrationCache();

  const [confirmReseed, setConfirmReseed] = useState(false);

  // The backend refuses to reseed in production; until the environment is
  // known the button stays disabled rather than guessing.
  const environment = stats.data?.runtime.environment;
  const isProduction = environment === 'production';

  return (
    <div className="space-y-4">
      <QueryState query={stats} skeleton={<SkeletonCards count={4} />}>
        {(data) => (
          <>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <MetricTile
                label="Database"
                value={data.database.state}
                hint={`${data.database.collections} collections`}
                tone={data.database.state === 'connected' ? 'success' : 'destructive'}
              />
              <MetricTile label="Uptime" value={`${Math.round(data.runtime.uptimeSeconds / 60)} min`} hint={data.runtime.node} />
              <MetricTile label="Heap used" value={`${data.runtime.memoryMb} MB`} hint={data.runtime.environment} />
              <MetricTile
                label="Total users"
                value={data.counts.User ?? 0}
                hint={Object.entries(data.usersByRole).map(([r, c]) => `${c} ${r}`).join(' · ')}
              />
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Database className="h-5 w-5" />
                  Collection Sizes
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                  {Object.entries(data.counts).map(([name, count]) => (
                    <div key={name} className="rounded-lg border p-3">
                      <p className="text-xl font-bold tabular-nums">{count.toLocaleString()}</p>
                      <p className="text-[11px] text-muted-foreground">{name}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </QueryState>

      {/* --- External integrations --- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Globe2 className="h-5 w-5" />
            Public API Integrations
          </CardTitle>
          <CardDescription>
            Open-Meteo, GBIF and OpenStreetMap Nominatim need no key and are always configured. The keyed
            services activate when their environment variable is set on the server.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {integrations.isPending ? (
            <LoadingState label="Probing integrations…" className="py-6" />
          ) : integrations.isError ? (
            <ErrorState error={integrations.error} onRetry={() => void integrations.refetch()} />
          ) : (
            <div className="space-y-2">
              {!integrations.data.reachable && (
                <Alert className="mb-3 border-warning/20 bg-warning/5">
                  <TriangleAlert className="h-4 w-4 text-warning" />
                  <AlertDescription className="text-xs">
                    Open-Meteo probe failed{integrations.data.probeReason ? `: ${integrations.data.probeReason}` : ''}.
                    Live air-quality, temperature and humidity readings will go stale until it recovers;
                    nothing is substituted for them.
                  </AlertDescription>
                </Alert>
              )}

              {integrations.data.integrations.map((integration) => (
                <div key={integration.id} className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
                  {integration.configured ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
                  ) : (
                    <XCircle className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{integration.name}</p>
                    <p className="text-[11px] text-muted-foreground">{integration.purpose}</p>
                  </div>
                  {integration.live !== null && (
                    <Badge
                      variant="outline"
                      className={cn(
                        'shrink-0 text-[10px]',
                        integration.live ? 'border-success/30 bg-success/10 text-success' : 'border-destructive/30 bg-destructive/10 text-destructive'
                      )}
                    >
                      {integration.live ? 'Reachable' : 'Unreachable'}
                    </Badge>
                  )}
                  {integration.requiresKey && (
                    <Badge variant="outline" className="shrink-0 text-[10px]">
                      {integration.configured ? 'Key set' : 'Key required'}
                    </Badge>
                  )}
                </div>
              ))}

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <p className="text-[11px] text-muted-foreground">
                  {integrations.data.cacheEntries} cached upstream responses in memory.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={clearCache.isPending || integrations.data.cacheEntries === 0}
                  onClick={() => clearCache.mutate()}
                >
                  <Eraser className={cn('mr-2 h-3.5 w-3.5', clearCache.isPending && 'animate-pulse')} />
                  {clearCache.isPending ? 'Clearing…' : 'Clear integration cache'}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* --- Maintenance actions --- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Maintenance Actions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Recompute ecosystem scores</p>
              <p className="text-[11px] text-muted-foreground">
                Re-derives every park&apos;s cached indices from current sensor, asset and observation data
              </p>
            </div>
            <Button variant="outline" size="sm" disabled={recompute.isPending} onClick={() => recompute.mutate()}>
              <RefreshCw className={cn('mr-2 h-3.5 w-3.5', recompute.isPending && 'animate-spin')} />
              Recompute
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Reindex the assistant</p>
              <p className="text-[11px] text-muted-foreground">
                Rebuilds the TF-IDF corpus — needed after a bulk import
              </p>
            </div>
            <Button variant="outline" size="sm" disabled={reindex.isPending} onClick={() => reindex.mutate()}>
              <RefreshCw className={cn('mr-2 h-3.5 w-3.5', reindex.isPending && 'animate-spin')} />
              Reindex
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/30 p-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-destructive">Reseed database — reference snapshot + sample records</p>
              <p className="text-[11px] text-muted-foreground">
                {isProduction
                  ? 'Unavailable: the server refuses to reseed in production.'
                  : 'Wipes every collection, reloads the reference snapshot and regenerates the sample records. Development only.'}
              </p>
            </div>
            {!isProduction && (
              <Button
                variant="outline"
                size="sm"
                className="text-destructive"
                disabled={!environment || reseed.isPending}
                onClick={() => setConfirmReseed(true)}
              >
                <Database className="mr-2 h-3.5 w-3.5" />
                Reseed database
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmReseed && !isProduction}
        onOpenChange={setConfirmReseed}
        title="Wipe and reseed the database?"
        description="Every collection is cleared and rebuilt: parks, species, GBIF observations, OpenStreetMap assets and sensors from the reference snapshot, plus newly generated demo accounts, incidents, work orders and citizen reports. Everything created since the last seed — including user accounts — is permanently lost, and every signed-in user, you included, will be signed out."
        confirmLabel="Wipe and reseed"
        onConfirm={async () => {
          try {
            await reseed.mutateAsync();
          } catch {
            /* toast already shown */
          }
        }}
      />
    </div>
  );
}
