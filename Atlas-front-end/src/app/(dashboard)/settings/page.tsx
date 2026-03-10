'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Cog, SlidersHorizontal, Shield, BrainCircuit, Users, AlertTriangle, Search, PlusCircle, LoaderCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';
import { apiGet, apiPost, apiPut, apiDelete, ApiError } from '@/lib/api';
import { toast } from 'sonner';

type Tab = 'general' | 'alert-tuning' | 'containment' | 'ml-baselines' | 'user-access';

const navItems = [
  { id: 'general',      label: 'General',                icon: Cog },
  { id: 'alert-tuning', label: 'Alert Tuning',           icon: SlidersHorizontal },
  { id: 'containment',  label: 'Containment',            icon: Shield },
  { id: 'ml-baselines', label: 'ML Baselines',           icon: BrainCircuit },
  { id: 'user-access',  label: 'User Access',            icon: Users },
];

type PlatformUser = { id: number; name: string; email: string; role: string; is_active: boolean; invite_pending: boolean; };

function UserAccessTab({ isAdmin }: { isAdmin: boolean }) {
  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showInviteDialog, setShowInviteDialog] = useState(false);

  useEffect(() => {
    apiGet<PlatformUser[]>('/api/auth/users').then(setUsers).catch(err => toast.error('Failed to load users', { description: (err as ApiError).message })).finally(() => setIsLoading(false));
  }, []);

  const filteredUsers = useMemo(() => 
    users.filter(u => u.name.toLowerCase().includes(search.toLowerCase()) || u.email.toLowerCase().includes(search.toLowerCase())),
    [users, search]
  );

  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardHeader>
        <CardTitle>User Access Management</CardTitle>
        <CardDescription>Manage team member roles and platform access.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4 border-b border-slate-800 pb-4">
          <div className="relative flex-grow"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" /><Input placeholder="Search users..." className="pl-9 bg-slate-950 border-slate-700" value={search} onChange={e => setSearch(e.target.value)} /></div>
          {isAdmin && <Button onClick={() => setShowInviteDialog(true)} className="bg-blue-600 hover:bg-blue-700 text-white"><PlusCircle className="mr-2 h-4 w-4" />Invite User</Button>}
        </div>
        <div className="overflow-x-auto">
          <Table><TableHeader><TableRow className="border-slate-800"><TableHead>User</TableHead><TableHead>Role</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={4} className="text-center py-8"><LoaderCircle className="mx-auto h-5 w-5 animate-spin text-slate-500"/></TableCell></TableRow>}
              {!isLoading && filteredUsers.map(user => <UserRow key={user.id} user={user} isAdmin={isAdmin} setUsers={setUsers} />)}
              {!isLoading && filteredUsers.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-slate-500 py-8">No users found.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </div>
      </CardContent>
      <InviteUserDialog open={showInviteDialog} onClose={() => setShowInviteDialog(false)} onInvited={newUser => setUsers(prev => [newUser, ...prev])} />
    </Card>
  );
}

function UserRow({ user, isAdmin, setUsers }: { user: PlatformUser, isAdmin: boolean, setUsers: React.Dispatch<React.SetStateAction<PlatformUser[]>>}) {
    const [isActionLoading, setIsActionLoading] = useState(false);
    const getInitials = (name: string) => name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();

    const handleRoleChange = async (newRole: string) => {
        setIsActionLoading(true);
        try {
            const updated = await apiPut<PlatformUser>(`/api/auth/users/${user.id}/role`, { role: newRole });
            setUsers(prev => prev.map(u => u.id === user.id ? updated : u));
            toast.success(`Role updated for ${user.name}`);
        } catch (err) { toast.error('Role change failed', { description: (err as ApiError).message }); }
        finally { setIsActionLoading(false); }
    }

    return (
        <TableRow className="border-slate-800">
            <TableCell><div className="flex items-center gap-3"><Avatar className="h-9 w-9"><AvatarFallback className="bg-slate-700 text-slate-300 text-xs">{getInitials(user.name)}</AvatarFallback></Avatar><div><p className="font-medium text-slate-200">{user.name}</p><p className="text-xs text-slate-500">{user.email}</p></div></div></TableCell>
            <TableCell>{isAdmin && user.is_active ? <Select value={user.role} onValueChange={handleRoleChange} disabled={isActionLoading}><SelectTrigger className="w-32 h-8 text-xs bg-slate-900 border-slate-700"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Admin">Admin</SelectItem><SelectItem value="Analyst">Analyst</SelectItem><SelectItem value="Read-Only">Read-Only</SelectItem></SelectContent></Select> : <span className="text-sm text-slate-300">{user.role}</span>}</TableCell>
            <TableCell><span className={`text-xs font-medium px-2 py-1 rounded-full ${user.is_active ? 'bg-green-500/10 text-green-400' : 'bg-slate-700 text-slate-400'}`}>{user.is_active ? 'Active' : 'Deactivated'}</span></TableCell>
            <TableCell className="text-right">{isAdmin && user.is_active && <Button variant="destructive" size="sm" disabled={isActionLoading}>Revoke</Button>}</TableCell>
        </TableRow>
    )
}

function InviteUserDialog({ open, onClose, onInvited }: { open: boolean, onClose: () => void, onInvited: (user: PlatformUser) => void }) {
    const [email, setEmail] = useState('');
    const [role, setRole] = useState('Analyst');
    const [isSaving, setIsSaving] = useState(false);

    const handleSubmit = async () => {
        if (!email) { toast.error('Email is required'); return; }
        setIsSaving(true);
        try {
            const newUser = await apiPost<PlatformUser>('/api/auth/users/invite', { name: email.split('@')[0], email, role });
            toast.success('User Invited'); onInvited(newUser); onClose(); setEmail(''); setRole('Analyst');
        } catch (err) { toast.error('Invite Failed', { description: (err as ApiError).message }); }
        finally { setIsSaving(false); }
    }

    return (
        <Dialog open={open} onOpenChange={onClose}>
            <DialogContent className="bg-slate-900 border-slate-800"><DialogHeader><DialogTitle>Invite New User</DialogTitle><DialogDescription>An invitation will be sent to their email address.</DialogDescription></DialogHeader>
                <div className="space-y-4 py-2">
                    <div className="space-y-1"><Label>Email Address</Label><Input type="email" value={email} onChange={e => setEmail(e.target.value)} /></div>
                    <div className="space-y-1"><Label>Role</Label><Select value={role} onValueChange={setRole}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="Admin">Admin</SelectItem><SelectItem value="Analyst">Analyst</SelectItem><SelectItem value="Read-Only">Read-Only</SelectItem></SelectContent></Select></div>
                </div>
                <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={handleSubmit} disabled={isSaving} className="bg-blue-600 hover:bg-blue-700 text-white">{isSaving && <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />}Send Invite</Button></DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export default function SettingsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'Admin';
  const [activeTab, setActiveTab] = useState<Tab>('general');

  const renderContent = () => {
    switch (activeTab) {
      case 'user-access': return <UserAccessTab isAdmin={!!isAdmin} />;
      default: return (
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader><CardTitle className="capitalize">{(activeTab as string).replace('-',' ')}</CardTitle><CardDescription>Configuration for {activeTab}.</CardDescription></CardHeader>
          <CardContent><p className="text-slate-500">Settings for this section are not yet implemented.</p></CardContent>
        </Card>
      );
    }
  };

  return (
    <div className="space-y-8 p-4 md:p-6 pb-8">
      <header><h1 className="text-2xl font-bold text-slate-100">Settings</h1><p className="text-sm text-slate-500 mt-1">Manage platform configuration and user access.</p></header>
      <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-8 items-start">
        <aside className="sticky top-20">
          <nav className="flex flex-col space-y-1">
            {navItems.map(item => (
              <Button
                key={item.id}
                variant="ghost"
                onClick={() => setActiveTab(item.id as Tab)}
                className={cn('w-full justify-start items-center gap-3', activeTab === item.id ? 'bg-slate-800 text-slate-50' : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200')}
              ><item.icon className="h-4 w-4" />{item.label}</Button>
            ))}
          </nav>
          {!isAdmin && <p className="mt-4 text-xs text-slate-500 px-3">Some settings are read-only.</p>}
        </aside>
        <main>{renderContent()}</main>
      </div>
    </div>
  );
}
