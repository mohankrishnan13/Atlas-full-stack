"use client";

import React, { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { Switch } from "../../../components/ui/switch";
import { Avatar, AvatarFallback } from "../../../components/ui/avatar";
import {
  Alert,
  AlertTitle,
  AlertDescription,
} from "../../../components/ui/alert";
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
import { useToast } from "../../../hooks/use-toast";
import { Terminal, LoaderCircle } from "lucide-react";

type SessionRecord = {
  id: number;
  ip_address: string;
  location: string;
  device_info: string;
  status: string;
  logged_at: string;
};

export default function ProfilePage() {
  const { user, setUser } = useAuth();
  const { toast } = useToast();

  const [name, setName] = useState(user?.name || "");
  const [email, setEmail] = useState(user?.email || "");
  const [phone, setPhone] = useState(user?.phone || "");
  const [avatar, setAvatar] = useState(user?.avatar || "");
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
      setPhone(user.phone || "");
      setAvatar(user.avatar || "");
      setTotpEnabled(user.totp_enabled);
    }
  }, [user]);

  useEffect(() => {
    const fetchSessions = async () => {
      setIsLoadingSessions(true);
      try {
        const data = await apiGet<SessionRecord[]>("/api/auth/sessions");
        setSessions(data);
      } catch (err: any) {
        toast({
          title: "Error",
          description: `Failed to load sessions: ${err.message}`,
          variant: "destructive",
        });
      } finally {
        setIsLoadingSessions(false);
      }
    };
    if (user) {
      fetchSessions();
    }
  }, [user, toast]);

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsUpdatingProfile(true);
    try {
      const updatedUser = await apiPut("/api/auth/me", { name, email, phone, avatar });
      setUser(updatedUser);
      toast({
        title: "Profile Updated",
        description: "Your profile has been successfully updated.",
      });
    } catch (err: any) {
      toast({
        title: "Error Updating Profile",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setIsUpdatingProfile(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast({
        title: "Validation Error",
        description: "New password and confirmation do not match.",
        variant: "destructive",
      });
      return;
    }
    setIsChangingPassword(true);
    try {
      await apiPost("/api/auth/change-password", {
        current_password: currentPassword,
        new_password: newPassword,
        confirm_password: confirmPassword,
      });
      toast({
        title: "Password Changed",
        description: "Your password has been successfully updated.",
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: any) {
      toast({
        title: "Error Changing Password",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setIsChangingPassword(false);
    }
  };

  const handleToggle2FA = async (checked: boolean) => {
    setIsToggling2FA(true);
    try {
      const response = await apiPatch("/api/auth/2fa", { enabled: checked });
      setTotpEnabled(checked);
      setUser((prevUser) => (prevUser ? { ...prevUser, totp_enabled: checked } : null));
      toast({
        title: "2FA Status Updated",
        description: response.message,
      });
    } catch (err: any) {
      toast({
        title: "Error Toggling 2FA",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setIsToggling2FA(false);
    }
  };

  if (!user) {
    return (
      <Alert variant="destructive" className="m-4">
        <Terminal className="h-4 w-4" />
        <AlertTitle>Authentication Error</AlertTitle>
        <AlertDescription>You must be logged in to view your profile.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <h1 className="text-3xl font-bold">User Profile</h1>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Update Preferences Card */}
        <Card>
          <CardHeader>
            <CardTitle>Update Preferences</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleUpdateProfile} className="space-y-4">
              <div className="flex items-center space-x-4">
                <Avatar className="h-16 w-16">
                  <AvatarFallback className="text-2xl">
                    {user.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="grid gap-1.5 w-full">
                  <Label htmlFor="avatar">Avatar URL</Label>
                  <Input
                    id="avatar"
                    value={avatar}
                    onChange={(e) => setAvatar(e.target.value)}
                    placeholder="https://example.com/avatar.jpg"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Phone</Label>
                <Input
                  id="phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
              <Button type="submit" className="w-full" disabled={isUpdatingProfile}>
                {isUpdatingProfile ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : ""} 
                Update Profile
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Change Password Card */}
        <Card>
          <CardHeader>
            <CardTitle>Change Password</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleChangePassword} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="current-password">Current Password</Label>
                <Input
                  id="current-password"
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-password">New Password</Label>
                <Input
                  id="new-password"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password">Confirm New Password</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </div>
              <Button type="submit" className="w-full" disabled={isChangingPassword}>
                {isChangingPassword ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : ""} 
                Change Password
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Two-Factor Authentication Card */}
        <Card>
          <CardHeader>
            <CardTitle>Two-Factor Authentication (2FA)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <Label htmlFor="2fa-toggle">
                {totpEnabled ? "2FA is Enabled" : "2FA is Disabled"}
              </Label>
              <Switch
                id="2fa-toggle"
                checked={totpEnabled}
                onCheckedChange={handleToggle2FA}
                disabled={isToggling2FA}
              />
            </div>
            <p className="text-sm text-muted-foreground">
              {totpEnabled
                ? "Your account is protected with 2FA. Remember to use your authenticator app." 
                : "Enable 2FA for an extra layer of security on your account."}
            </p>
            {isToggling2FA && <LoaderCircle className="h-4 w-4 animate-spin" />} 
          </CardContent>
        </Card>

        {/* Recent Login Sessions Card */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Login Sessions</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoadingSessions ? (
              <div>Loading sessions...</div>
            ) : sessions.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>IP Address</TableHead>
                    <TableHead>Device/Browser</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Time</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sessions.map((session) => (
                    <TableRow key={session.id}>
                      <TableCell>{session.ip_address}</TableCell>
                      <TableCell>{session.device_info}</TableCell>
                      <TableCell>{session.status}</TableCell>
                      <TableCell>{session.logged_at}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-sm text-muted-foreground">No recent login sessions found.</p>
            )}
          </CardContent>
        </Card>

      </div>
    </div>
  );
}
