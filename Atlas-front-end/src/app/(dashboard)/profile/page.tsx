'use client';

import React, { useEffect, useState, useRef } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import { apiGet, apiPut, apiPost, apiPatch, ApiError } from '@/lib/api';
import { Clock, Lock, Mail, Shield, LoaderCircle } from 'lucide-react';

type SessionRecord = {
  id: number;
  ip_address: string;
  location: string;
  device_info: string;
  status: string;
  logged_at: string;
};

export default function ProfilePage() {
  const { toast } = useToast();
  const { user, setUser, isAuthLoading } = useAuth();

  // ── Profile form state ────────────────────────────────────────────────────
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  // ── Password form state ───────────────────────────────────────────────────
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSavingPassword, setIsSavingPassword] = useState(false);

  // ── 2FA state ─────────────────────────────────────────────────────────────
  const [totpEnabled, setTotpEnabled] = useState(false);
  const [isTogglingTwoFa, setIsTogglingTwoFa] = useState(false);

  // ── Session history ───────────────────────────────────────────────────────
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [isLoadingSessions, setIsLoadingSessions] = useState(true);

  // Populate form when user loads
  useEffect(() => {
    if (!user) return;
    const nameParts = user.name.split(' ');
    setFirstName(nameParts[0] ?? '');
    setLastName(nameParts.slice(1).join(' '));
    setEmail(user.email);
    setPhone(user.phone ?? '');
    setTotpEnabled(user.totp_enabled);
  }, [user]);

  // Fetch session history
  useEffect(() => {
    apiGet<SessionRecord[]>('/api/auth/sessions')
      .then(setSessions)
      .catch(() => setSessions([]))
      .finally(() => setIsLoadingSessions(false));
  }, []);

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleSaveProfile = async () => {
    setIsSavingProfile(true);
    try {
      const updated = await apiPut('/api/auth/me', {
        name: `${firstName} ${lastName}`.trim(),
        email,
        phone: phone || null,
      });
      setUser(updated as any);
      toast({ title: 'Profile Updated', description: 'Your personal information has been saved.' });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Update Failed', description: err.message });
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleUpdatePassword = async () => {
    if (newPassword !== confirmPassword) {
      toast({ variant: 'destructive', title: 'Passwords Do Not Match', description: 'Please ensure both fields match.' });
      return;
    }
    setIsSavingPassword(true);
    try {
      await apiPost('/api/auth/change-password', {
        current_password: currentPassword,
        new_password: newPassword,
        confirm_password: confirmPassword,
      });
      toast({ title: 'Password Updated', description: 'Your password has been changed successfully.' });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Password Change Failed', description: err.message });
    } finally {
      setIsSavingPassword(false);
    }
  };

  const handleToggle2FA = async (enabled: boolean) => {
    setIsTogglingTwoFa(true);
    try {
      const result = await apiPatch<{ totp_enabled: boolean }>('/api/auth/2fa', { enabled });
      setTotpEnabled(result.totp_enabled);
      setUser(user ? { ...user, totp_enabled: result.totp_enabled } : null);
      toast({
        title: '2FA Updated',
        description: `Two-factor authentication has been ${enabled ? 'enabled' : 'disabled'}.`,
      });
    } catch (err: any) {
      toast({ variant: 'destructive', title: '2FA Update Failed', description: err.message });
    } finally {
      setIsTogglingTwoFa(false);
    }
  };

  const initials = user
    ? user.name.split(' ').map((n) => n[0]).join('').toUpperCase()
    : '??';

  if (isAuthLoading) {
    return (
      <div className="space-y-8">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center gap-6">
        <Avatar className="h-24 w-24 border-2 border-slate-800">
          <AvatarImage src={user?.avatar ?? ''} alt={user?.name} data-ai-hint="person face" />
          <AvatarFallback className="text-2xl">{initials}</AvatarFallback>
        </Avatar>
        <div>
          <h1 className="text-3xl font-bold">{user?.name ?? 'Loading...'}</h1>
          <p className="text-muted-foreground">{user?.role} · ATLAS SOC</p>
          <p className="text-sm text-muted-foreground">{user?.email}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
        <div className="space-y-8">

          {/* Personal Information */}
          <Card>
            <CardHeader>
              <CardTitle>Personal Information</CardTitle>
              <CardDescription>Update your personal details.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="first-name">First Name</Label>
                  <Input id="first-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="last-name">Last Name</Label>
                  <Input id="last-name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email Address</Label>
                <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Phone Number</Label>
                <Input id="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 (555) 000-0000" />
              </div>
              <Button onClick={handleSaveProfile} disabled={isSavingProfile} className="bg-blue-600 hover:bg-blue-700">
                {isSavingProfile && <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />}
                Save Changes
              </Button>
            </CardContent>
          </Card>

          {/* Account Preferences */}
          <Card>
            <CardHeader>
              <CardTitle>Account Preferences</CardTitle>
              <CardDescription>Notification and timezone settings.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="timezone">Timezone</Label>
                <Select defaultValue="utc">
                  <SelectTrigger id="timezone"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="utc">UTC (Coordinated Universal Time)</SelectItem>
                    <SelectItem value="est">EST (Eastern Standard Time)</SelectItem>
                    <SelectItem value="pst">PST (Pacific Standard Time)</SelectItem>
                    <SelectItem value="ist">IST (India Standard Time)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                <div>
                  <h4 className="font-semibold flex items-center gap-2"><Mail className="h-4 w-4" />Daily Threat Summaries</h4>
                  <p className="text-xs text-muted-foreground">Receive a 24-hour activity digest via email.</p>
                </div>
                <Switch defaultChecked />
              </div>
              <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                <div>
                  <h4 className="font-semibold flex items-center gap-2"><Shield className="h-4 w-4" />Critical Alert Notifications</h4>
                  <p className="text-xs text-muted-foreground">Immediate notification for Critical-severity incidents.</p>
                </div>
                <Switch defaultChecked />
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-8">

          {/* Security */}
          <Card>
            <CardHeader>
              <CardTitle>Security & Authentication</CardTitle>
              <CardDescription>Manage your password and two-factor authentication.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4 p-4 border border-slate-800 rounded-md">
                <h4 className="font-semibold flex items-center gap-2"><Lock className="h-4 w-4" />Change Password</h4>
                <div className="space-y-2">
                  <Label htmlFor="current-password">Current Password</Label>
                  <Input id="current-password" type="password" placeholder="••••••••" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-password">New Password</Label>
                  <Input id="new-password" type="password" placeholder="••••••••" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm-password">Confirm New Password</Label>
                  <Input id="confirm-password" type="password" placeholder="••••••••" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
                </div>
                <Button onClick={handleUpdatePassword} disabled={isSavingPassword} variant="secondary">
                  {isSavingPassword && <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />}
                  Update Password
                </Button>
              </div>

              <div className="flex items-center justify-between p-4 border border-slate-800 rounded-md">
                <div>
                  <h4 className="font-semibold">Two-Factor Authentication (2FA)</h4>
                  <p className="text-sm text-muted-foreground">Recommended for all SOC environments.</p>
                </div>
                <Switch
                  checked={totpEnabled}
                  onCheckedChange={handleToggle2FA}
                  disabled={isTogglingTwoFa}
                />
              </div>
            </CardContent>
          </Card>

          {/* Session History */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5" /> Recent Account Activity
              </CardTitle>
              <CardDescription>Your last 10 sign-in attempts.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date / Time</TableHead>
                    <TableHead>IP Address</TableHead>
                    <TableHead>Device</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoadingSessions && Array.from({ length: 3 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={4}><Skeleton className="h-5 w-full" /></TableCell>
                    </TableRow>
                  ))}
                  {!isLoadingSessions && sessions.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="text-xs whitespace-nowrap">{s.logged_at}</TableCell>
                      <TableCell className="font-mono text-xs">{s.ip_address}</TableCell>
                      <TableCell className="text-xs max-w-[160px] truncate" title={s.device_info}>{s.device_info}</TableCell>
                      <TableCell className="text-xs">
                        <span className={s.status.startsWith('Success') ? 'text-emerald-400' : 'text-red-400'}>
                          {s.status}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                  {!isLoadingSessions && sessions.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground">No session history available.</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
