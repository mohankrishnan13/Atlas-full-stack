'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Cog, SlidersHorizontal, Shield, BrainCircuit, Users, AlertTriangle, Search, PlusCircle, LoaderCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';
import { apiGet, apiPost, apiPut, apiDelete } from '@/lib/api';
import { toast } from 'sonner';

type Tab = 'general' | 'alert-tuning' | 'containment' | 'ml-baselines' | 'user-access';

const navItems = [
  { id: 'general',      label: 'General',                icon: Cog },
  { id: 'alert-tuning', label: 'Alert Tuning',           icon: SlidersHorizontal },
  { id: 'containment',  label: 'Progressive Containment', icon: Shield },
  { id: 'ml-baselines', label: 'ML Baselines',           icon: BrainCircuit },
  { id: 'user-access',  label: 'User Access',            icon: Users },
];

type PlatformUser = {
  id: number;
  name: string;
  email: string;
  role: string;
  is_active: boolean;
  invite_pending: boolean;
  avatar?: string | null;
};

// ── Role styling ──────────────────────────────────────────────────────────────
const roleStyle: Record<string, string> = {
  Admin:       'bg-purple-600/20 text-purple-300 border-purple-500/30',
  Analyst:     'bg-blue-600/20 text-blue-300 border-blue-500/30',
  'Read-Only': 'bg-slate-600/50 text-slate-300 border-slate-500/30',
};

// ── Invite User Modal ─────────────────────────────────────────────────────────
function InviteUserDialog({
  open,
  onClose,
  onInvited,
}: {
  open: boolean;
  onClose: () => void;
  onInvited: (user: PlatformUser) => void;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('Analyst');
  const [tempPassword, setTempPassword] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = async () => {
    if (!name || !email) {
      toast.error('Validation Error', { description: 'Name and email are required.' });
      return;
    }
    setIsSaving(true);
    try {
      const newUser = await apiPost<PlatformUser>('/api/auth/users/invite', {
        name, email, role, password: tempPassword || 'ChangeMe123!',
      });
      toast.success('User Invited', { description: `${name} has been added as ${role}.` });
      onInvited(newUser);
      onClose();
      setName(''); setEmail(''); setRole('Analyst'); setTempPassword('');
    } catch (err: any) {
      toast.error('Invite Failed', { description: err.message });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite New User</DialogTitle>
          <DialogDescription>Add a new analyst or administrator to the ATLAS platform.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Full Name</Label>
            <Input placeholder="Jane Smith" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Email Address</Label>
            <Input type="email" placeholder="jane@atlas.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Role</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Admin">Admin</SelectItem>
                <SelectItem value="Analyst">Analyst</SelectItem>
                <SelectItem value="Read-Only">Read-Only</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Temporary Password <span className="text-muted-foreground text-xs">(optional, defaults to ChangeMe123!)</span></Label>
            <Input type="password" placeholder="ChangeMe123!" value={tempPassword} onChange={(e) => setTempPassword(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={isSaving} className="bg-emerald-600 hover:bg-emerald-700">
            {isSaving && <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />}
            Send Invite
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── User Access Tab ───────────────────────────────────────────────────────────
function UserAccessTab({ isAdmin }: { isAdmin: boolean }) {
  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showInviteDialog, setShowInviteDialog] = useState(false);
  const [actionLoading, setActionLoading] = useState<Record<number, boolean>>({});

  const fetchUsers = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await apiGet<PlatformUser[]>('/api/auth/users');
      setUsers(data);
    } catch (err: any) {
      toast.error('Failed to Load Users', { description: err.message });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const setLoading = (userId: number, val: boolean) =>
    setActionLoading((prev) => ({ ...prev, [userId]: val }));

  const handleRevokeAccess = async (user: PlatformUser) => {
    if (!confirm(`Revoke access for ${user.name}? Their account will be deactivated.`)) return;
    setLoading(user.id, true);
    try {
      await apiDelete(`/api/auth/users/${user.id}`);
      toast.success('Access Revoked', { description: `${user.name}'s account has been deactivated.` });
      setUsers((prev) => prev.map((u) => u.id === user.id ? { ...u, is_active: false } : u));
    } catch (err: any) {
      toast.error('Revoke Failed', { description: err.message });
    } finally {
      setLoading(user.id, false);
    }
  };

  const handleChangeRole = async (user: PlatformUser, newRole: string) => {
    setLoading(user.id, true);
    try {
      const updated = await apiPut<PlatformUser>(`/api/auth/users/${user.id}/role`, { role: newRole });
      toast.success('Role Updated', { description: `${user.name} is now ${newRole}.` });
      setUsers((prev) => prev.map((u) => u.id === updated.id ? updated : u));
    } catch (err: any) {
      toast.error('Role Change Failed', { description: err.message });
    } finally {
      setLoading(user.id, false);
    }
  };

  const filtered = users.filter(
    (u) =>
      u.name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>User Access Management</CardTitle>
        <CardDescription>
          Enterprise RBAC — Manage team member roles and application access scopes
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between mb-4 border-b border-slate-800 pb-4 gap-4">
          <div className="relative w-full max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name or email..."
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {isAdmin && (
            <Button
              onClick={() => setShowInviteDialog(true)}
              className="bg-emerald-600 hover:bg-emerald-700 text-white shrink-0"
            >
              <PlusCircle className="mr-2 h-4 w-4" />
              Invite Team Member
            </Button>
          )}
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User Info</TableHead>
              <TableHead>Role Badge</TableHead>
              <TableHead>App Access Scope</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && Array.from({ length: 3 }).map((_, i) => (
              <TableRow key={i}>
                <TableCell colSpan={5}><Skeleton className="h-10 w-full" /></TableCell>
              </TableRow>
            ))}
            {!isLoading && filtered.map((u) => {
              const isWorking = actionLoading[u.id];
              const statusColor = u.invite_pending
                ? 'bg-yellow-500'
                : u.is_active
                ? 'bg-emerald-500'
                : 'bg-red-500';
              const statusLabel = u.invite_pending
                ? 'Invite Pending'
                : u.is_active
                ? 'Active'
                : 'Deactivated';

              return (
                <TableRow key={u.id} className={!u.is_active ? 'opacity-50' : ''}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar className="w-9 h-9">
                        <AvatarFallback className="bg-slate-700 text-slate-300 text-xs">
                          {u.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <div className="font-medium">{u.name}</div>
                        <div className="text-sm text-muted-foreground">{u.email}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    {isAdmin && u.is_active ? (
                      <Select value={u.role} onValueChange={(r) => handleChangeRole(u, r)} disabled={isWorking}>
                        <SelectTrigger className="w-32 h-7 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Admin">Admin</SelectItem>
                          <SelectItem value="Analyst">Analyst</SelectItem>
                          <SelectItem value="Read-Only">Read-Only</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : (
                      <Badge variant="outline" className={roleStyle[u.role] ?? ''}>{u.role}</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="bg-slate-800/40 border-slate-700 text-slate-300">All Applications</Badge>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className={cn('h-2 w-2 rounded-full', statusColor)} />
                      <span className="text-sm">{statusLabel}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    {isAdmin && u.is_active && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-red-400 border-red-500/50 hover:bg-red-950 hover:text-red-300"
                        onClick={() => handleRevokeAccess(u)}
                        disabled={isWorking}
                      >
                        {isWorking
                          ? <LoaderCircle className="h-4 w-4 animate-spin" />
                          : 'Revoke Access'}
                      </Button>
                    )}
                    {!u.is_active && (
                      <span className="text-xs text-muted-foreground italic">Deactivated</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
            {!isLoading && filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground">No users found.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>

      <InviteUserDialog
        open={showInviteDialog}
        onClose={() => setShowInviteDialog(false)}
        onInvited={(u) => setUsers((prev) => [...prev, u])}
      />
    </Card>
  );
}

// ── Main Settings Page ────────────────────────────────────────────────────────
export default function SettingsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'Admin';
  const [activeTab, setActiveTab] = useState<Tab>('general');

  const [appId, setAppId] = useState<string>('');
  const [appName, setAppName] = useState<string>('');
  const [isLoadingConfig, setIsLoadingConfig] = useState<boolean>(true);

  const [quarantineAuto, setQuarantineAuto] = useState<boolean>(false);
  const [quarantined, setQuarantined] = useState<
    { workstationId: string; user: string; timeQuarantined: string; action: string }[]
  >([]);
  const [isLoadingQuarantine, setIsLoadingQuarantine] = useState<boolean>(false);

  const [systemName, setSystemName] = useState('ATLAS | Enterprise Anomaly Monitoring System');
  const [timezone, setTimezone] = useState('utc');
  const [retention, setRetention] = useState(90);
  const [criticalThreshold, setCriticalThreshold] = useState([85]);
  const [warningThreshold, setWarningThreshold] = useState([60]);
  const [emailAlerts, setEmailAlerts] = useState(true);
  const [softLimit, setSoftLimit] = useState([300]);
  const [hardBlock, setHardBlock] = useState([1000]);
  const [accumulationWindow, setAccumulationWindow] = useState([7]);
  const [autoDismiss, setAutoDismiss] = useState(true);
  const [enableML, setEnableML] = useState(true);
  const [autoQuarantine, setAutoQuarantine] = useState(false);
  const [trainingWindow, setTrainingWindow] = useState(30);
  const [modelSensitivity, setModelSensitivity] = useState('balanced');
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setIsLoadingConfig(true);
    apiGet<{ applications: { id: string; name: string }[] }>("/header-data")
      .then((hd) => {
        if (cancelled) return;
        const first = hd.applications?.[0];
        if (first) {
          setAppId(first.id);
          setAppName(first.name);
        }
      })
      .catch((err: any) => {
        if (cancelled) return;
        toast.error("Failed to load applications", { description: err?.message || "Request failed." });
      })
      .finally(() => {
        if (!cancelled) setIsLoadingConfig(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const fetchAppConfig = useCallback(async () => {
    if (!appId) return;
    setIsLoadingConfig(true);
    try {
      const cfg = await apiGet<any>(`/api/settings/apps/${appId}`);
      setWarningThreshold([cfg.warningAnomalyScore ?? 60]);
      setCriticalThreshold([cfg.criticalAnomalyScore ?? 80]);
      setSoftLimit([cfg.softRateLimitCallsPerMin ?? 300]);
      setHardBlock([cfg.hardBlockThresholdCallsPerMin ?? 1000]);
      setAutoQuarantine(!!cfg.autoQuarantineLaptops);
      setTrainingWindow(cfg.trainingWindowDays ?? 30);
      setModelSensitivity(String(cfg.modelSensitivityPct ?? 58));
      setEnableML(!!cfg.autoUpdateBaselinesWeekly);
    } catch (err: any) {
      toast.error("Failed to load app settings", { description: err?.message || "Request failed." });
    } finally {
      setIsLoadingConfig(false);
    }
  }, [appId]);

  useEffect(() => {
    fetchAppConfig();
  }, [fetchAppConfig]);

  const fetchQuarantine = useCallback(async () => {
    if (!appId) return;
    setIsLoadingQuarantine(true);
    try {
      const resp = await apiGet<any>(`/api/settings/apps/${appId}/quarantine`);
      setQuarantineAuto(!!resp.autoQuarantineLaptops);
      setQuarantined(resp.quarantined || []);
    } catch (err: any) {
      toast.error("Failed to load quarantine", { description: err?.message || "Request failed." });
    } finally {
      setIsLoadingQuarantine(false);
    }
  }, [appId]);

  useEffect(() => {
    fetchQuarantine();
  }, [fetchQuarantine]);

  const handleSaveSettings = async () => {
    if (!appId) return;
    setIsSavingSettings(true);
    try {
      await apiPut(`/api/settings/apps/${appId}`, {
        warningAnomalyScore: warningThreshold[0],
        criticalAnomalyScore: criticalThreshold[0],
        softRateLimitCallsPerMin: softLimit[0],
        hardBlockThresholdCallsPerMin: hardBlock[0],
        autoQuarantineLaptops: autoQuarantine,
        trainingWindowDays: trainingWindow,
        modelSensitivityPct: Number(modelSensitivity) || 58,
        autoUpdateBaselinesWeekly: enableML,
      });
      toast.success('Settings Saved', { description: 'System configuration has been updated.' });
      await fetchQuarantine();
    } catch (err: any) {
      toast.error('Save Failed', { description: err?.message || 'Request failed.' });
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleLiftQuarantine = async (workstationId: string) => {
    if (!appId) return;
    try {
      const resp = await apiPost<any>(`/api/settings/apps/${appId}/quarantine/lift`, { workstationId });
      toast.success('Quarantine lifted', { description: resp?.message || workstationId });
      await fetchQuarantine();
    } catch (err: any) {
      toast.error('Lift failed', { description: err?.message || 'Request failed.' });
    }
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'general':
        return (
          <Card>
            <CardHeader><CardTitle>General System Settings</CardTitle></CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label>System Name</Label>
                <Input value={systemName} onChange={(e) => setSystemName(e.target.value)} disabled={!isAdmin} />
              </div>
              <div className="space-y-2">
                <Label>Timezone</Label>
                <Select value={timezone} onValueChange={setTimezone} disabled={!isAdmin}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="utc">UTC</SelectItem>
                    <SelectItem value="est">EST</SelectItem>
                    <SelectItem value="pst">PST</SelectItem>
                    <SelectItem value="ist">IST</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Data Retention Period (Days)</Label>
                <Input type="number" value={retention} onChange={(e) => setRetention(Number(e.target.value))} disabled={!isAdmin} />
                <p className="text-sm text-muted-foreground">Logs older than this will be archived to cold storage.</p>
              </div>
              {isAdmin && (
                <Button onClick={handleSaveSettings} disabled={isSavingSettings} className="bg-blue-600 hover:bg-blue-700">
                  {isSavingSettings && <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />}
                  Save Settings
                </Button>
              )}
            </CardContent>
          </Card>
        );

      case 'alert-tuning':
        return (
          <Card>
            <CardHeader><CardTitle>Alert Threshold Configuration</CardTitle></CardHeader>
            <CardContent className="space-y-8">
              <div className="space-y-4">
                <Label>Critical Threshold (Score {criticalThreshold[0]}–100)</Label>
                <Slider value={criticalThreshold} onValueChange={setCriticalThreshold} max={100} min={80} step={1} className="[&>span]:bg-red-500" disabled={!isAdmin} />
              </div>
              <div className="space-y-4">
                <Label>Warning Threshold (Score {warningThreshold[0]}–79)</Label>
                <Slider value={warningThreshold} onValueChange={setWarningThreshold} max={79} min={50} step={1} className="[&>span]:bg-orange-500" disabled={!isAdmin} />
              </div>
              <div className="pt-4 border-t border-slate-800 space-y-4">
                <h4 className="text-lg font-semibold">Notifications</h4>
                <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
                  <Label>Enable Email Alerts for Critical Incidents</Label>
                  <Switch checked={emailAlerts} onCheckedChange={setEmailAlerts} disabled={!isAdmin} />
                </div>
              </div>
              {isAdmin && <Button onClick={handleSaveSettings} disabled={isSavingSettings} className="bg-blue-600 hover:bg-blue-700">{isSavingSettings && <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />}Save Settings</Button>}
            </CardContent>
          </Card>
        );

      case 'containment':
        return (
          <Card>
            <CardHeader>
              <CardTitle>Progressive Containment Rules</CardTitle>
              <CardDescription>Automated response thresholds based on anomaly frequency.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-8">
              <div className="space-y-4">
                <Label>Soft Rate Limit ({softLimit[0]} calls/min)</Label>
                <Slider value={softLimit} onValueChange={setSoftLimit} max={1000} min={100} step={10} className="[&>span]:bg-blue-500" disabled={!isAdmin} />
              </div>
              <div className="space-y-4">
                <Label>Hard Block Threshold ({hardBlock[0]} calls/min)</Label>
                <Slider value={hardBlock} onValueChange={setHardBlock} max={5000} min={500} step={50} className="[&>span]:bg-red-500" disabled={!isAdmin} />
              </div>
              <div className="space-y-4">
                <Label>Accumulation Window ({accumulationWindow[0]} days)</Label>
                <Slider value={accumulationWindow} onValueChange={setAccumulationWindow} max={30} min={1} step={1} className="[&>span]:bg-orange-500" disabled={!isAdmin} />
              </div>
              <div className="space-y-4 pt-4 border-t border-slate-800">
                <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
                  <Label>Auto-dismiss known benign activity</Label>
                  <Switch checked={autoDismiss} onCheckedChange={setAutoDismiss} disabled={!isAdmin} />
                </div>
                <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
                  <Label>Enable ML-based baseline learning</Label>
                  <Switch checked={enableML} onCheckedChange={setEnableML} disabled={!isAdmin} />
                </div>
                <div className="flex items-center justify-between p-4 bg-muted rounded-lg border border-red-900/50">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5 text-red-500" />
                    <Label className="text-red-400">Auto-quarantine infected endpoints</Label>
                  </div>
                  <Switch checked={autoQuarantine} onCheckedChange={setAutoQuarantine} disabled={!isAdmin} />
                </div>
              </div>

              <div className="pt-4 border-t border-slate-800 space-y-4">
                <h4 className="text-lg font-semibold">Quarantined Endpoints</h4>
                {isLoadingQuarantine ? (
                  <div className="text-sm text-muted-foreground">Loading quarantine...</div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Workstation</TableHead>
                        <TableHead>User</TableHead>
                        <TableHead>Time Quarantined</TableHead>
                        <TableHead className="text-right">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {quarantined.map((q) => (
                        <TableRow key={q.workstationId}>
                          <TableCell className="font-mono text-xs">{q.workstationId}</TableCell>
                          <TableCell>{q.user}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{q.timeQuarantined}</TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => handleLiftQuarantine(q.workstationId)}
                              disabled={!isAdmin}
                            >
                              {q.action || 'Lift Quarantine'}
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                      {quarantined.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={4} className="text-center text-muted-foreground">
                            No quarantined endpoints.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                )}
              </div>

              {isAdmin && <Button onClick={handleSaveSettings} disabled={isSavingSettings} className="bg-blue-600 hover:bg-blue-700">{isSavingSettings && <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />}Save Settings</Button>}
            </CardContent>
          </Card>
        );

      case 'ml-baselines':
        return (
          <Card>
            <CardHeader><CardTitle>Machine Learning Configuration</CardTitle></CardHeader>
            <CardContent className="space-y-6">
              <div className="bg-blue-900/30 border border-blue-500/30 text-blue-300 text-sm rounded-lg p-4 flex items-center gap-3">
                <BrainCircuit className="h-5 w-5" />
                <span>ML Engine Status: Active. Learning from the past {trainingWindow} days of traffic.</span>
              </div>
              <div className="space-y-2">
                <Label>Training Period Window (Days)</Label>
                <Input type="number" value={trainingWindow} onChange={(e) => setTrainingWindow(Number(e.target.value))} disabled={!isAdmin} />
              </div>
              <div className="space-y-2">
                <Label>Model Sensitivity Strategy</Label>
                <Select value={modelSensitivity} onValueChange={setModelSensitivity} disabled={!isAdmin}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="conservative">Conservative (Fewer False Positives)</SelectItem>
                    <SelectItem value="balanced">Balanced</SelectItem>
                    <SelectItem value="aggressive">Aggressive (Catch All Anomalies)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {isAdmin && <Button onClick={handleSaveSettings} disabled={isSavingSettings} className="bg-blue-600 hover:bg-blue-700">{isSavingSettings && <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />}Save Settings</Button>}
            </CardContent>
          </Card>
        );

      case 'user-access':
        return <UserAccessTab isAdmin={isAdmin} />;

      default:
        return null;
    }
  };

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-bold">Settings</h1>
      <div className="grid grid-cols-1 md:grid-cols-[240px_1fr] gap-8 items-start">
        <aside className="sticky top-24">
          <nav className="flex flex-col space-y-1">
            {navItems.map((item) => {
              const isActive = activeTab === item.id;
              return (
                <Button
                  key={item.id}
                  variant="ghost"
                  onClick={() => setActiveTab(item.id as Tab)}
                  className={cn(
                    'w-full justify-start items-center gap-3 px-3 py-2 text-md',
                    isActive
                      ? 'bg-blue-900/50 text-blue-300 border-l-2 border-blue-400'
                      : 'text-muted-foreground hover:bg-slate-800 hover:text-white'
                  )}
                >
                  <item.icon className="h-5 w-5" />
                  {item.label}
                </Button>
              );
            })}
          </nav>
          {!isAdmin && (
            <p className="mt-4 text-xs text-muted-foreground px-3">
              ⚠ Some settings are read-only. Admin role required to make changes.
            </p>
          )}
        </aside>
        <main>{renderContent()}</main>
      </div>
    </div>
  );
}
