import React, { useState } from 'react';
import {
  Shield,
  KeyRound,
  Mail,
  Database,
  CheckCircle2,
  AlertCircle,
  Eye,
  EyeOff,
  Save,
  Clock,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { changePassword, changeEmail, getMe } from '../lib/api';
import { formatDate } from '../utils/formatters';

interface AssignedTankDetail {
  id: string;
  tank_number: string;
  room_number?: string | null;
  facility_name?: string | null;
  status?: string | null;
}

export const AccountPage: React.FC = () => {
  const { user, refetchUser } = useAuth();

  // Full user profile state from API (for assigned tanks & created_at)
  const [profileData, setProfileData] = useState<{
    assigned_tanks?: AssignedTankDetail[];
    created_at?: string | null;
  } | null>(null);

  React.useEffect(() => {
    let mounted = true;
    getMe()
      .then((res) => {
        if (mounted && res.data) {
          setProfileData(res.data);
        }
      })
      .catch((err) => {
        console.error('Failed to load profile data', err);
      });
    return () => {
      mounted = false;
    };
  }, []);

  // Password Change State
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showOldPw, setShowOldPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const [pwPending, setPwPending] = useState(false);
  const [pwSuccess, setPwSuccess] = useState('');
  const [pwError, setPwError] = useState('');

  // Email Change State
  const [newEmail, setNewEmail] = useState('');
  const [emailCurrentPw, setEmailCurrentPw] = useState('');
  const [showEmailPw, setShowEmailPw] = useState(false);
  const [emailPending, setEmailPending] = useState(false);
  const [emailSuccess, setEmailSuccess] = useState('');
  const [emailError, setEmailError] = useState('');

  // Role display label formatter
  const formatRole = (role?: string | null) => {
    if (!role) return 'Staff';
    switch (role.toLowerCase()) {
      case 'super_admin':
        return 'Super Admin';
      case 'chair':
        return 'Chair';
      case 'admin':
        return 'Admin';
      case 'manager':
        return 'Facility Manager';
      case 'staff':
        return 'Staff Member';
      default:
        return role.replace(/_/g, ' ');
    }
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwSuccess('');
    setPwError('');

    if (!oldPassword) {
      setPwError('Please enter your current password.');
      return;
    }
    if (newPassword.length < 6) {
      setPwError('New password must be at least 6 characters long.');
      return;
    }
    if (oldPassword === newPassword) {
      setPwError('New password cannot be the same as your current password.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwError('New passwords do not match. Please verify your entries.');
      return;
    }

    try {
      setPwPending(true);
      const res = await changePassword({
        old_password: oldPassword,
        new_password: newPassword,
        confirm_password: confirmPassword,
      });
      setPwSuccess(res.data?.message || 'Password updated successfully!');
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      const msg = err.response?.data?.detail || 'Failed to update password. Please try again.';
      setPwError(msg);
    } finally {
      setPwPending(false);
    }
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmailSuccess('');
    setEmailError('');

    const cleanEmail = newEmail.trim().toLowerCase();
    if (!cleanEmail) {
      setEmailError('Please enter a valid new email address.');
      return;
    }
    if (user?.email && cleanEmail === user.email.toLowerCase()) {
      setEmailError('New email address must be different from your current email.');
      return;
    }
    if (!emailCurrentPw) {
      setEmailError('Please enter your current password to authorize this email change.');
      return;
    }

    try {
      setEmailPending(true);
      const res = await changeEmail({
        new_email: cleanEmail,
        current_password: emailCurrentPw,
      });
      const updatedEmail = res.data?.email || cleanEmail;
      setEmailSuccess(`Email successfully changed to ${updatedEmail}`);
      await refetchUser();
      setNewEmail('');
      setEmailCurrentPw('');
    } catch (err: any) {
      const msg = err.response?.data?.detail || 'Failed to update email address.';
      setEmailError(msg);
    } finally {
      setEmailPending(false);
    }
  };

  const assignedTanks = profileData?.assigned_tanks ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-12">
      {/* 1. HERO USER PROFILE CARD */}
      <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-5">
            <div className="flex h-20 w-20 flex-shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#005596] to-[#003A66] text-2xl font-black text-white shadow-md">
              {`${user?.first_name?.[0] ?? ''}${user?.last_name?.[0] ?? ''}`}
            </div>

            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="text-2xl font-extrabold text-slate-900">
                  {user?.first_name} {user?.last_name}
                </h1>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-3 py-0.5 text-xs font-bold text-[#005596]">
                  <Shield className="h-3.5 w-3.5" />
                  {formatRole(user?.role)}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                  <CheckCircle2 className="h-3 w-3" />
                  Active Status
                </span>
              </div>

              <p className="flex items-center gap-2 text-sm text-slate-600">
                <Mail className="h-4 w-4 text-slate-400" />
                <span className="font-medium text-slate-800">{user?.email}</span>
              </p>

              {profileData?.created_at && (
                <p className="flex items-center gap-2 text-xs text-slate-400">
                  <Clock className="h-3.5 w-3.5" />
                  <span>Member since {formatDate(profileData.created_at)}</span>
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* 2. ASSIGNED TANKS CARD */}
        <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h2 className="flex items-center gap-2 text-base font-bold text-slate-900">
              <Database className="h-5 w-5 text-[#005596]" />
              My Assigned Tanks
            </h2>
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-bold text-slate-700">
              {assignedTanks.length} {assignedTanks.length === 1 ? 'Tank' : 'Tanks'}
            </span>
          </div>

          {assignedTanks.length === 0 ? (
            <div className="py-8 text-center text-slate-400">
              <Database className="mx-auto mb-2 h-8 w-8 text-slate-300" />
              <p className="text-xs font-semibold text-slate-600">No tanks currently assigned</p>
              <p className="mt-1 text-[11px] text-slate-400">
                Tanks assigned to your account by a manager or administrator will appear here.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {assignedTanks.map((tank) => (
                <div
                  key={tank.id}
                  className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 transition-colors hover:border-blue-300 hover:bg-blue-50/30"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-slate-900">
                      Tank {tank.tank_number}
                    </span>
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                        tank.status === 'active'
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-slate-200 text-slate-700'
                      }`}
                    >
                      {tank.status ? tank.status.toUpperCase() : 'ACTIVE'}
                    </span>
                  </div>
                  <div className="mt-1.5 space-y-0.5 text-xs text-slate-600">
                    <div>
                      <span className="font-semibold text-slate-500">Room: </span>
                      {tank.room_number ? `Room ${tank.room_number}` : 'N/A'}
                    </div>
                    {tank.facility_name && (
                      <div className="truncate">
                        <span className="font-semibold text-slate-500">Facility: </span>
                        {tank.facility_name}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 3. CHANGE EMAIL CARD */}
        <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="border-b border-slate-100 pb-3">
            <h2 className="flex items-center gap-2 text-base font-bold text-slate-900">
              <Mail className="h-5 w-5 text-[#005596]" />
              Update Email Address
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Change the email address associated with your account.
            </p>
          </div>

          <form onSubmit={handleEmailSubmit} className="space-y-4">
            {emailError && (
              <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-700">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                <span>{emailError}</span>
              </div>
            )}

            {emailSuccess && (
              <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs font-semibold text-emerald-700">
                <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                <span>{emailSuccess}</span>
              </div>
            )}

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-700">New Email Address</label>
              <input
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="e.g. user@uwindsor.ca"
                required
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-800 shadow-xs focus:border-[#005596] focus:outline-none focus:ring-1 focus:ring-[#005596]"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-700">
                Current Password (to authorize change)
              </label>
              <div className="relative">
                <input
                  type={showEmailPw ? 'text' : 'password'}
                  value={emailCurrentPw}
                  onChange={(e) => setEmailCurrentPw(e.target.value)}
                  placeholder="Enter current password"
                  required
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 pr-10 text-sm font-medium text-slate-800 shadow-xs focus:border-[#005596] focus:outline-none focus:ring-1 focus:ring-[#005596]"
                />
                <button
                  type="button"
                  onClick={() => setShowEmailPw(!showEmailPw)}
                  className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600"
                >
                  {showEmailPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={emailPending}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#005596] px-4 py-2 text-xs font-bold text-white shadow-sm transition-colors hover:bg-[#003A66] disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {emailPending ? 'Updating Email…' : 'Update Email Address'}
            </button>
          </form>
        </div>
      </div>

      {/* 4. SECURITY (CHANGE PASSWORD) CARD */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
        <div className="border-b border-slate-100 pb-3">
          <h2 className="flex items-center gap-2 text-base font-bold text-slate-900">
            <KeyRound className="h-5 w-5 text-[#005596]" />
            Security & Change Password
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Ensure your account stays secure by choosing a strong, unique password.
          </p>
        </div>

        <form onSubmit={handlePasswordSubmit} className="space-y-4">
          {pwError && (
            <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-700">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <span>{pwError}</span>
            </div>
          )}

          {pwSuccess && (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs font-semibold text-emerald-700">
              <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
              <span>{pwSuccess}</span>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {/* Current Password */}
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-700">Current Password</label>
              <div className="relative">
                <input
                  type={showOldPw ? 'text' : 'password'}
                  value={oldPassword}
                  onChange={(e) => setOldPassword(e.target.value)}
                  placeholder="Enter current password"
                  required
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 pr-10 text-sm font-medium text-slate-800 shadow-xs focus:border-[#005596] focus:outline-none focus:ring-1 focus:ring-[#005596]"
                />
                <button
                  type="button"
                  onClick={() => setShowOldPw(!showOldPw)}
                  className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600"
                >
                  {showOldPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* New Password */}
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-700">New Password</label>
              <div className="relative">
                <input
                  type={showNewPw ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Min 6 characters"
                  required
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 pr-10 text-sm font-medium text-slate-800 shadow-xs focus:border-[#005596] focus:outline-none focus:ring-1 focus:ring-[#005596]"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPw(!showNewPw)}
                  className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600"
                >
                  {showNewPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* Confirm New Password */}
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-700">Confirm New Password</label>
              <div className="relative">
                <input
                  type={showConfirmPw ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter new password"
                  required
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 pr-10 text-sm font-medium text-slate-800 shadow-xs focus:border-[#005596] focus:outline-none focus:ring-1 focus:ring-[#005596]"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPw(!showConfirmPw)}
                  className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600"
                >
                  {showConfirmPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={pwPending}
              className="inline-flex items-center gap-2 rounded-lg bg-[#005596] px-6 py-2.5 text-xs font-bold text-white shadow-sm transition-colors hover:bg-[#003A66] disabled:opacity-50"
            >
              <KeyRound className="h-4 w-4" />
              {pwPending ? 'Updating Password…' : 'Update Password'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
