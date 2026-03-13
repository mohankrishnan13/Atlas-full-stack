"use client";

import React, { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription
} from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { Switch } from "../../../components/ui/switch";
import { Avatar, AvatarFallback } from "../../../components/ui/avatar";
import {
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow
} from "../../../components/ui/table";
import { useAuth } from "../../../context/AuthContext";
import { apiPut, apiPost, apiPatch, apiGet, ApiError } from "../../../lib/api";
import { toast } from "sonner";
import { LoaderCircle, User, Lock, Fingerprint, History } from "lucide-react";

type SessionRecord = {
  id: number;
  ip_address: string;
  location: string;
  device_info: string;
  status: string;
  logged_at: string;
};

// Helper to format date strings
const formatDate = (dateString: string) => {
  return new Date(dateString).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};


export default function ProfilePage() {
  const { user, setUser } = useAuth();

  const [name, setName] = useState(user?.name || "");
  const [email, setEmail] = useState(user?.email || "");
  const [isUpdatingProfile, setIsUpdatingProfile] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  const [totpEnabled, setTotpEnabled] = useState(user?.totp_enabled || false);
  const [isToggling2FA, setIsToggling2FA] = useState(false);

  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [isLoadingSessions, setIsLoadingSessions] = useState(true);

  useEffect(() => {
    if (user) {
      setName(user.name);
      setEmail(user.email);
      setTotpEnabled(user.totp_enabled);
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      apiGet<SessionRecord[]>("/api/auth/sessions")
        .then(setSessions)
        .catch(err => toast.error("Failed to load sessions.", { description: (err as ApiError).message }))
        .finally(() => setIsLoadingSessions(false));
    }
  }, [user]);

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsUpdatingProfile(true);
    try {
      const updatedUser = await apiPut("/api/auth/me", { name, email });
      setUser(updatedUser);
      toast.success("Profile Updated", { description: "Your details have been saved." });
    } catch (err) {
      toast.error("Update Failed", { description: (err as ApiError).message });
    } finally {
      setIsUpdatingProfile(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast.error("Passwords do not match.");
      return;
    }
    setIsChangingPassword(true);
    try {
      await apiPost("/api/auth/change-password", { current_password: currentPassword, new_password: newPassword, confirm_password: confirmPassword });
      toast.success("Password Changed");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      toast.error("Password Change Failed", { description: (err as ApiError).message });
    } finally {
      setIsChangingPassword(false);
    }
  };

  const handleToggle2FA = async (enabled: boolean) => {
    setIsToggling2FA(true);
    try {
      const res = await apiPatch<{ message: string }>("/api/auth/2fa", { enabled });
      setTotpEnabled(enabled);
      setUser(prev => prev ? { ...prev, totp_enabled: enabled } : null);
      toast.success("2FA Status Updated", { description: res.message });
    } catch (err) {
      toast.error("2FA Update Failed", { description: (err as ApiError).message });
      // Revert optimistic update on failure
      setTotpEnabled(!enabled);
    } finally {
      setIsToggling2FA(false);
    }
  };
  
  const getInitials = (name: string) => name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();

  if (!user) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <p className="text-slate-500">You must be logged in to view your profile.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8 p-4 md:p-6 pb-8">
      <header>
        <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
          <User className="w-6 h-6 text-blue-400" />
          User Profile
        </h1>
        <p className="text-sm text-slate-500 mt-1 ml-8">Manage your account details and security settings.</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* PROFILE DETAILS */}
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-slate-200">
              <User className="w-5 h-5 text-slate-400" />
              Profile Details
            </CardTitle>
            <CardDescription className="text-slate-500">Update your name and contact information.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleUpdateProfile} className="space-y-4">
               <div className="flex items-center space-x-4">
                <Avatar className="h-16 w-16">
                  <AvatarFallback className="text-2xl bg-slate-700 text-slate-300">
                    {getInitials(user.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="text-sm text-slate-400">
                  <p className="font-semibold text-slate-200">{user.name}</p>
                  <p>{user.email}</p>
                </div>
              </div>

              <div className="space-y-1">
                <Label htmlFor="name" className="text-slate-400">Full Name</Label>
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} className="bg-slate-950 border-slate-700 focus:ring-blue-500" />
              </div>

              <div className="space-y-1">
                <Label htmlFor="email" className="text-slate-400">Email Address</Label>
                <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="bg-slate-950 border-slate-700 focus:ring-blue-500" />
              </div>
              
              <Button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white" disabled={isUpdatingProfile}>
                {isUpdatingProfile && <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />}
                Save Changes
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* CHANGE PASSWORD */}
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-slate-200">
              <Lock className="w-5 h-5 text-slate-400" />
              Change Password
            </CardTitle>
            <CardDescription className="text-slate-500">For security, choose a strong, unique password.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleChangePassword} className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="current-password">Current Password</Label>
                <Input id="current-password" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} className="bg-slate-950 border-slate-700 focus:ring-blue-500" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="new-password">New Password</Label>
                <Input id="new-password" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="bg-slate-950 border-slate-700 focus:ring-blue-500" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="confirm-password">Confirm New Password</Label>
                <Input id="confirm-password" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="bg-slate-950 border-slate-700 focus:ring-blue-500" />
              </div>
              <Button type="submit" className="w-full" disabled={isChangingPassword}>
                {isChangingPassword && <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />}
                Update Password
              </Button>
            </form>
          </CardContent>
        </Card>

      </div>
        
      {/* 2FA & SESSIONS */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* TWO-FACTOR AUTHENTICATION */}
          <Card className="bg-slate-900 border-slate-800">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-slate-200">
                <Fingerprint className="w-5 h-5 text-slate-400" />
                Two-Factor Authentication (2FA)
              </CardTitle>
              <CardDescription className="text-slate-500">Add an extra layer of security to your account.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between p-4 bg-slate-950/50 rounded-lg border border-slate-800">
                <div className="flex items-center gap-3">
                   {isToggling2FA ? <LoaderCircle className="h-5 w-5 animate-spin text-slate-400" /> : <Switch id="2fa-toggle" checked={totpEnabled} onCheckedChange={handleToggle2FA} />}
                   <Label htmlFor="2fa-toggle" className="font-medium text-slate-300">
                      {totpEnabled ? "Two-Factor Authentication is ON" : "Two-Factor Authentication is OFF"}
                   </Label>
                </div>
                <span className={`text-xs font-semibold px-2 py-1 rounded-md ${totpEnabled ? 'bg-green-500/10 text-green-400' : 'bg-yellow-500/10 text-yellow-400'}`}>
                    {totpEnabled ? "SECURE" : "AT RISK"}
                </span>
              </div>
            </CardContent>
          </Card>
      
          {/* RECENT SESSIONS */}
          <Card className="bg-slate-900 border-slate-800">
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-slate-200">
                    <History className="w-5 h-5 text-slate-400" />
                    Recent Login Sessions
                </CardTitle>
                <CardDescription className="text-slate-500">Your recent account activity across all devices.</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="overflow-x-auto">
                    <Table>
                        <TableHeader>
                            <TableRow className="border-slate-800">
                                <TableHead className="text-slate-400">Device</TableHead>
                                <TableHead className="text-slate-400">IP Address</TableHead>
                                <TableHead className="text-slate-400 text-right">Time</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {isLoadingSessions ? (
                                <TableRow><TableCell colSpan={3} className="text-center text-slate-500 py-8"><LoaderCircle className="mx-auto h-5 w-5 animate-spin" /></TableCell></TableRow>
                            ) : sessions.length > 0 ? (
                                sessions.slice(0, 5).map((session) => (
                                    <TableRow key={session.id} className="border-slate-800">
                                        <TableCell className="font-medium text-slate-300">{session.device_info}</TableCell>
                                        <TableCell className="text-slate-400 font-mono text-xs">{session.ip_address}</TableCell>
                                        <TableCell className="text-right text-slate-500 text-xs">{formatDate(session.logged_at)}</TableCell>
                                    </TableRow>
                                ))
                            ) : (
                                <TableRow><TableCell colSpan={3} className="text-center text-slate-500 py-8">No session data available.</TableCell></TableRow>
                            )}
                        </TableBody>
                    </Table>
                </div>
            </CardContent>
          </Card>
      </div>

    </div>
  );
}
