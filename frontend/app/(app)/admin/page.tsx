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

import { useEffect, useState } from 'react';
import {
  Shield, Users, Settings2, ScrollText, Activity, Plus, Pencil, Trash2,
  RefreshCw, Database, TriangleAlert, Globe2, CheckCircle2, XCircle,
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
import { Slider } from '@/components/ui/slider';
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
import { useAuth } from '@/components/providers/auth-provider';
import {
  useUsers, useSettings, useAuditLog, useSystemStats, useParks, useIntegrationStatus,
  useCreateUser, useUpdateUser, useDeleteUser, useUpdateSettings,
  useRecomputeScores, useReindexAssistant, useReseed,
} from '@/lib/hooks/use-api';
import { cn } from '@/lib/utils';
import type { User, UserRole } from '@/lib/types';

const ROLES: UserRole[] = ['citizen', 'ecologist', 'officer', 'admin'];

const ROLE_TONE: Record<UserRole, string> = {
  admin: 'bg-destructive/15 text-destructive border-destructive/30',
  officer: 'bg-warning/15 text-warning border-warning/30',
  ecologist: 'bg-info/15 text-info border-info/30',
  citizen: 'bg-secondary text-secondary-foreground border-border',
};

const userSchema = z.object({
  name: z.string().min(2, 'Name is required').max(120),
  email: z.string().email('Enter a valid email address'),
  password: z.string().max(128).optional(),
  role: z.enum(['citizen', 'ecologist', 'officer', 'admin']),
  park: z.string().optional(),
  active: z.boolean(),
});

type UserValues = z.infer<typeof userSchema>;

export default function AdminPage() {
  const { can, user } = useAuth();

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
        description="User accounts, system configuration, the audit trail, and platform maintenance actions."
        icon="Shield"
      />

      <Tabs defaultValue="users" className="space-y-4">
        <TabsList className="grid w-full grid-cols-2 sm:w-auto sm:grid-cols-4">
          <TabsTrigger value="users"><Users className="mr-1.5 h-3.5 w-3.5" />Users</TabsTrigger>
          <TabsTrigger value="settings"><Settings2 className="mr-1.5 h-3.5 w-3.5" />Settings</TabsTrigger>
          <TabsTrigger value="audit"><ScrollText className="mr-1.5 h-3.5 w-3.5" />Audit log</TabsTrigger>
          <TabsTrigger value="system"><Activity className="mr-1.5 h-3.5 w-3.5" />System</TabsTrigger>
        </TabsList>

        <TabsContent value="users"><UsersTab /></TabsContent>
        <TabsContent value="settings"><SettingsTab /></TabsContent>
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
  });
  const deleteUser = useDeleteUser();

  const columns = [
    {
      key: 'name',
      header: 'User',
      render: (row: User) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.name}</p>
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
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditing(row)}>
            <Pencil className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setDeleting(row)}>
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
          if (deleting) await deleteUser.mutateAsync(deleting.id);
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
    resolver: zodResolver(userSchema),
    values: user
      ? {
          name: user.name,
          email: user.email,
          password: '',
          role: user.role,
          park: typeof user.park === 'object' && user.park ? user.park.id : (user.park ?? '') || '',
          active: user.active,
        }
      : { name: '', email: '', password: '', role: 'citizen', park: '', active: true },
  });

  const submit = form.handleSubmit(async (values) => {
    const payload = {
      name: values.name,
      email: values.email,
      role: values.role,
      park: values.park || null,
      active: values.active,
    };

    if (user) {
      // An empty password field means "leave it unchanged", not "blank it".
      await updateUser.mutateAsync({
        id: user.id,
        body: values.password ? { ...payload, password: values.password } : payload,
      });
    } else {
      await createUser.mutateAsync({ ...payload, password: values.password || 'greenpulse123' });
    }

    form.reset();
    onClose();
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{user ? 'Edit user' : 'Add a user'}</DialogTitle>
          <DialogDescription>
            {user
              ? 'Leave the password blank to keep the current one.'
              : 'A password of at least 8 characters is required; leaving it blank uses the demo default.'}
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
            <Input id="password" type="password" placeholder="••••••••" {...form.register('password')} />
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
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={createUser.isPending || updateUser.isPending}>
              {createUser.isPending || updateUser.isPending ? 'Saving…' : user ? 'Save changes' : 'Create user'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

function SettingsTab() {
  const query = useSettings();
  const updateSettings = useUpdateSettings();

  // Local weight state so the user can rebalance freely and only be validated
  // on save — blocking each individual keystroke would make it unusable.
  const [weights, setWeights] = useState({ air: 0.25, water: 0.2, soil: 0.15, tree: 0.2, biodiversity: 0.2 });
  const [general, setGeneral] = useState({
    organisationName: '', city: '', contactEmail: '',
    anomalyZThreshold: 3, aiAutoIncidentConfidence: 85,
    enableSensorSimulation: true, enablePublicReporting: true,
  });

  useEffect(() => {
    if (!query.data) return;
    setWeights(query.data.healthIndexWeights);
    setGeneral({
      organisationName: query.data.organisationName,
      city: query.data.city,
      contactEmail: query.data.contactEmail,
      anomalyZThreshold: query.data.anomalyZThreshold,
      aiAutoIncidentConfidence: query.data.aiAutoIncidentConfidence,
      enableSensorSimulation: query.data.enableSensorSimulation,
      enablePublicReporting: query.data.enablePublicReporting,
    });
  }, [query.data]);

  const sum = Object.values(weights).reduce((a, b) => a + b, 0);
  const balanced = Math.abs(sum - 1) <= 0.01;

  /** Scale every weight so the set sums to exactly 1. */
  const normalise = () => {
    if (sum <= 0) return;
    setWeights((current) =>
      Object.fromEntries(
        Object.entries(current).map(([key, value]) => [key, Math.round((value / sum) * 100) / 100])
      ) as typeof current
    );
  };

  if (query.isPending) return <LoadingState label="Loading settings…" />;
  if (query.isError) return <ErrorState error={query.error} onRetry={query.refetch} />;

  return (
    <div className="space-y-4">
      {/* --- Health index weights --- */}
      <Card className="border-primary/20">
        <CardHeader>
          <CardTitle className="text-lg">Ecosystem Health Index Weights</CardTitle>
          <CardDescription>
            EHI = Σ wₖ·Sₖ ⁄ Σ wₖ over the five sub-indices. Changing these re-scores every park in
            the system, so they must sum to 1.00.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {(Object.keys(weights) as (keyof typeof weights)[]).map((key) => (
            <div key={key} className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="capitalize">{key === 'tree' ? 'Tree health' : key}</Label>
                <span className="text-sm font-medium tabular-nums">{weights[key].toFixed(2)}</span>
              </div>
              <Slider
                value={[weights[key] * 100]}
                onValueChange={([v]) => setWeights((w) => ({ ...w, [key]: v / 100 }))}
                min={0}
                max={100}
                step={1}
              />
            </div>
          ))}

          <div
            className={cn(
              'flex flex-wrap items-center justify-between gap-2 rounded-lg p-3',
              balanced ? 'bg-success/10' : 'bg-destructive/10'
            )}
          >
            <div className="flex items-center gap-2">
              {balanced ? (
                <CheckCircle2 className="h-4 w-4 text-success" />
              ) : (
                <TriangleAlert className="h-4 w-4 text-destructive" />
              )}
              <span className={cn('text-sm', balanced ? 'text-success' : 'text-destructive')}>
                Sum: {sum.toFixed(2)} {balanced ? '' : '— must be 1.00'}
              </span>
            </div>
            {!balanced && (
              <Button size="sm" variant="outline" onClick={normalise}>Normalise to 1.00</Button>
            )}
          </div>

          <Button
            className="w-full"
            disabled={!balanced || updateSettings.isPending}
            onClick={() => updateSettings.mutate({ healthIndexWeights: weights })}
          >
            {updateSettings.isPending ? 'Saving and re-scoring…' : 'Save weights and recompute all scores'}
          </Button>
        </CardContent>
      </Card>

      {/* --- Algorithm parameters --- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Algorithm Parameters</CardTitle>
          <CardDescription>Thresholds used by the anomaly detector and the AI escalation rule</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Anomaly z-score threshold</Label>
              <span className="text-sm font-medium tabular-nums">{general.anomalyZThreshold.toFixed(1)}σ</span>
            </div>
            <Slider
              value={[general.anomalyZThreshold * 10]}
              onValueChange={([v]) => setGeneral((g) => ({ ...g, anomalyZThreshold: v / 10 }))}
              min={10}
              max={60}
              step={1}
            />
            <p className="text-xs text-muted-foreground">
              A reading is flagged when |z| exceeds this. 3σ covers ~99.7% of a normal
              distribution — lowering it catches more, at the cost of false positives.
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>AI auto-escalation confidence floor</Label>
              <span className="text-sm font-medium tabular-nums">{general.aiAutoIncidentConfidence}%</span>
            </div>
            <Slider
              value={[general.aiAutoIncidentConfidence]}
              onValueChange={([v]) => setGeneral((g) => ({ ...g, aiAutoIncidentConfidence: v }))}
              min={50}
              max={100}
              step={1}
            />
            <p className="text-xs text-muted-foreground">
              A high-severity detection opens an incident automatically only above this confidence.
              Below it, the finding is queued for human review — a false fire alarm is expensive.
            </p>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <Label>Sensor simulation</Label>
                <p className="text-[11px] text-muted-foreground">
                  Generate readings on a timer, anchored to live weather data
                </p>
              </div>
              <Switch
                checked={general.enableSensorSimulation}
                onCheckedChange={(v) => setGeneral((g) => ({ ...g, enableSensorSimulation: v }))}
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <Label>Public reporting</Label>
                <p className="text-[11px] text-muted-foreground">Allow citizens to submit reports</p>
              </div>
              <Switch
                checked={general.enablePublicReporting}
                onCheckedChange={(v) => setGeneral((g) => ({ ...g, enablePublicReporting: v }))}
              />
            </div>
          </div>

          <Button
            className="w-full"
            disabled={updateSettings.isPending}
            onClick={() =>
              updateSettings.mutate({
                anomalyZThreshold: general.anomalyZThreshold,
                aiAutoIncidentConfidence: general.aiAutoIncidentConfidence,
                enableSensorSimulation: general.enableSensorSimulation,
                enablePublicReporting: general.enablePublicReporting,
              })
            }
          >
            Save algorithm parameters
          </Button>
        </CardContent>
      </Card>

      {/* --- Organisation --- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Organisation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Organisation name</Label>
              <Input
                value={general.organisationName}
                onChange={(e) => setGeneral((g) => ({ ...g, organisationName: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>City</Label>
              <Input value={general.city} onChange={(e) => setGeneral((g) => ({ ...g, city: e.target.value }))} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Contact email</Label>
            <Input
              type="email"
              value={general.contactEmail}
              onChange={(e) => setGeneral((g) => ({ ...g, contactEmail: e.target.value }))}
            />
          </div>
          <Button
            variant="outline"
            className="w-full"
            disabled={updateSettings.isPending}
            onClick={() =>
              updateSettings.mutate({
                organisationName: general.organisationName,
                city: general.city,
                contactEmail: general.contactEmail,
              })
            }
          >
            Save organisation details
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

const ACTION_TONE: Record<string, string> = {
  create: 'border-success/30 bg-success/10 text-success',
  update: 'border-info/30 bg-info/10 text-info',
  delete: 'border-destructive/30 bg-destructive/10 text-destructive',
  login: 'border-border bg-secondary text-secondary-foreground',
  assign: 'border-warning/30 bg-warning/10 text-warning',
  resolve: 'border-success/30 bg-success/10 text-success',
  seed: 'border-border bg-secondary text-secondary-foreground',
};

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
              ...Object.keys(ACTION_TONE).map((a) => ({ label: a, value: a })),
            ],
          },
          {
            label: 'Entity',
            value: entity,
            onChange: (v) => { setEntity(v); setPage(1); },
            options: [
              { label: 'All entities', value: 'all' },
              ...['Incident', 'Asset', 'User', 'CitizenReport', 'WorkOrder', 'Setting', 'Park'].map((e) => ({
                label: e,
                value: e,
              })),
            ],
          },
        ]}
      />

      <Alert className="border-dashed">
        <ScrollText className="h-4 w-4" />
        <AlertDescription className="text-xs">
          Append-only. Every create, update and delete writes one entry with the changed fields —
          municipal systems need to answer &ldquo;who changed this and when&rdquo;, and corrections
          are new entries rather than edits.
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
                    <Badge variant="outline" className={cn('shrink-0 text-[10px] capitalize', ACTION_TONE[entry.action])}>
                      {entry.action}
                    </Badge>

                    <div className="min-w-0 flex-1">
                      <p className="text-sm">
                        <span className="font-medium">{entry.actorName}</span>
                        <span className="text-muted-foreground"> ({entry.actorRole}) </span>
                        {entry.action}d{' '}
                        <span className="font-medium">{entry.entity}</span>
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

  const [confirmReseed, setConfirmReseed] = useState(false);

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
                value={data.counts.User}
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
            The four keyless services are always on. The keyed ones activate automatically when
            their environment variable is present.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {integrations.isPending ? (
            <LoadingState label="Probing integrations…" className="py-6" />
          ) : !integrations.data ? (
            <p className="py-4 text-center text-sm text-muted-foreground">Status unavailable.</p>
          ) : (
            <div className="space-y-2">
              {!integrations.data.reachable && (
                <Alert className="mb-3 border-warning/20 bg-warning/5">
                  <TriangleAlert className="h-4 w-4 text-warning" />
                  <AlertDescription className="text-xs">
                    Upstream probe failed: {integrations.data.probeReason}. The system falls back to
                    generated data — nothing breaks, but readings are no longer anchored to reality.
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
                  {integration.requiresKey && (
                    <Badge variant="outline" className="shrink-0 text-[10px]">
                      {integration.configured ? 'Key set' : 'Key required'}
                    </Badge>
                  )}
                </div>
              ))}

              <p className="pt-1 text-[11px] text-muted-foreground">
                {integrations.data.cacheEntries} cached upstream responses in memory.
              </p>
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
                Re-derives every park&apos;s cached indices from current sensor and observation data
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
              <p className="text-sm font-medium text-destructive">Regenerate the demonstration dataset</p>
              <p className="text-[11px] text-muted-foreground">
                Wipes every collection and reseeds. Disabled in production.
              </p>
            </div>
            <Button variant="outline" size="sm" className="text-destructive" onClick={() => setConfirmReseed(true)}>
              <Database className="mr-2 h-3.5 w-3.5" />
              Reseed
            </Button>
          </div>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmReseed}
        onOpenChange={setConfirmReseed}
        title="Regenerate the demonstration dataset?"
        description="Every collection is cleared and rebuilt from the seed script. All incidents, reports, observations and user accounts created since the last seed will be lost."
        confirmLabel="Wipe and reseed"
        onConfirm={async () => { await reseed.mutateAsync(); }}
      />
    </div>
  );
}
