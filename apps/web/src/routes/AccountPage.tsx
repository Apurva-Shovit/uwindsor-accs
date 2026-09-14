import React, { useMemo, useState } from 'react';
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
  Building2,
  Layers,
  Lock,
  Unlock,
  Bell,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { changePassword, changeEmail, verifyPassword, getMe, updateEmailNotifications } from '../lib/api';
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

  const [isPwVerified, setIsPwVerified] = useState(false);
  const [verifyPending, setVerifyPending] = useState(false);

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

  const isManagerPlus = ['super_admin', 'chair', 'admin', 'manager'].includes(user?.role?.toLowerCase() || '');

  // System Email Notification State (Manager & Higher Positions)
  const [emailNotifEnabled, setEmailNotifEnabled] = useState<boolean>(user?.email_notifications_enabled ?? true);
  const [emailNotifPending, setEmailNotifPending] = useState<boolean>(false);
  const [emailNotifError, setEmailNotifError] = useState<string>('');

  React.useEffect(() => {
    if (user?.email_notifications_enabled !== undefined) {
      setEmailNotifEnabled(user.email_notifications_enabled);
    }
  }, [user?.email_notifications_enabled]);

  const handleToggleEmailNotifications = async (newVal: boolean) => {
    setEmailNotifError('');
    try {
      setEmailNotifPending(true);
      await updateEmailNotifications(newVal);
      setEmailNotifEnabled(newVal);
      await refetchUser();
    } catch (err: any) {
      const msg = err.response?.data?.detail || 'Failed to update email notification preferences.';
      setEmailNotifError(msg);
    } finally {
      setEmailNotifPending(false);
    }
  };

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

  // Step 1: Verify Current Password
  const handleVerifyCurrentPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwError('');
    setPwSuccess('');

    if (!oldPassword) {
      setPwError('Please enter your current password to proceed.');
      return;
    }

    try {
      setVerifyPending(true);
      await verifyPassword(oldPassword);
      setIsPwVerified(true);
      setPwSuccess('Current password verified! Enter your new password below.');
    } catch (err: any) {
      setIsPwVerified(false);
      const msg = err.response?.data?.detail || 'Incorrect current password. Please try again.';
      setPwError(msg);
    } finally {
      setVerifyPending(false);
    }
  };

  // Step 2: Change Password Submit
  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwSuccess('');
    setPwError('');

    if (!isPwVerified) {
      setPwError('Please verify your current password first.');
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
      setPwError('New passwords do not match. Please check your typing.');
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
      setIsPwVerified(false);
    } catch (err: any) {
      const msg = err.response?.data?.detail || 'Failed to update password. Please try again.';
      setPwError(msg);
    } finally {
      setPwPending(false);
    }
  };

  // Email Change Submit
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

  // Group assigned tanks hierarchically by Facility -> Room -> Tanks
  const groupedTanks = useMemo(() => {
    const map: Record<string, Record<string, AssignedTankDetail[]>> = {};

    for (const tank of assignedTanks) {
      const facility = tank.facility_name || 'Main Facility';
      const room = tank.room_number ? `Room ${tank.room_number}` : 'Unassigned Room';

      if (!map[facility]) {
        map[facility] = {};
      }
      if (!map[facility][room]) {
        map[facility][room] = [];
      }
      map[facility][room].push(tank);
    }

    return map;
  }, [assignedTanks]);

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-12">
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
                  Active Account
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

      {/* 2-COLUMN LAYOUT */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
        {/* LEFT COLUMN: ASSIGNED TANKS + SYSTEM EMAIL NOTIFICATIONS */}
        <div className="space-y-6">
          {/* MY ASSIGNED TANKS CARD */}
          <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="flex items-center gap-2 text-base font-bold text-slate-900">
                <Database className="h-5 w-5 text-[#005596]" />
                My Assigned Tanks
              </h2>
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-bold text-slate-700">
                {assignedTanks.length} {assignedTanks.length === 1 ? 'Tank' : 'Tanks'} Total
              </span>
            </div>

            {assignedTanks.length === 0 ? (
              <div className="py-12 text-center text-slate-400">
                <Database className="mx-auto mb-2 h-8 w-8 text-slate-300" />
                <p className="text-xs font-semibold text-slate-600">No tanks currently assigned</p>
                <p className="mt-1 text-[11px] text-slate-400">
                  Tanks assigned to your account by a manager or administrator will appear here grouped by facility and room.
                </p>
              </div>
            ) : (
              <div className="space-y-5 pt-1">
                {Object.entries(groupedTanks).map(([facilityName, rooms]) => (
                  <div key={facilityName} className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/50 p-4">
                    {/* Facility Header */}
                    <div className="flex items-center gap-2 border-b border-slate-200/80 pb-2">
                      <Building2 className="h-4 w-4 text-[#005596]" />
                      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                        {facilityName}
                      </h3>
                    </div>

                    {/* Rooms List */}
                    <div className="space-y-3 pl-1">
                      {Object.entries(rooms).map(([roomNumber, tanks]) => (
                        <div key={roomNumber} className="space-y-2">
                          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                            <Layers className="h-3.5 w-3.5 text-slate-400" />
                            <span>{roomNumber}</span>
                          </div>

                          {/* Tank Pills (NO STATUS TAGS) */}
                          <div className="flex flex-wrap gap-2 pl-5">
                            {tanks.map((tank) => (
                              <div
                                key={tank.id}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-800 shadow-2xs transition-colors hover:border-blue-300 hover:bg-blue-50/40"
                              >
                                <span>Tank {tank.tank_number}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* SYSTEM EMAIL NOTIFICATIONS CARD (BELOW ASSIGNED TANKS) */}
          {isManagerPlus && (
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              {emailNotifError && (
                <div className="mb-3 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-700">
                  <AlertCircle className="h-4 w-4 flex-shrink-0" />
                  <span>{emailNotifError}</span>
                </div>
              )}

              <div className="flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-base font-bold text-slate-900">
                  <Bell className="h-5 w-5 text-[#005596]" />
                  System Email Notifications
                </h2>

                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    disabled={emailNotifPending}
                    onClick={() => handleToggleEmailNotifications(!emailNotifEnabled)}
                    className={`relative inline-flex h-7 w-14 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-[#005596] focus:ring-offset-2 disabled:opacity-50 ${
                      emailNotifEnabled ? 'bg-[#005596]' : 'bg-slate-300'
                    }`}
                    role="switch"
                    aria-checked={emailNotifEnabled}
                  >
                    <span
                      className={`pointer-events-none absolute top-1 text-[9px] font-black uppercase tracking-wider transition-opacity duration-200 ${
                        emailNotifEnabled ? 'left-2 text-white opacity-100' : 'right-2 text-slate-700 opacity-100'
                      }`}
                    >
                      {emailNotifEnabled ? 'ON' : 'OFF'}
                    </span>
                    <span
                      className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
                        emailNotifEnabled ? 'translate-x-7' : 'translate-x-0'
                      }`}
                    />
                  </button>
                  <span
                    className={`text-xs font-black uppercase tracking-wider ${
                      emailNotifEnabled ? 'text-[#005596]' : 'text-slate-500'
                    }`}
                  >
                    {emailNotifEnabled ? 'ON' : 'OFF'}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* RIGHT COLUMN: CHANGE EMAIL + CHANGE PASSWORD */}
        <div className="space-y-6">
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

          {/* 4. CHANGE PASSWORD CARD (PROGRESSIVE VERIFICATION) */}
          <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="border-b border-slate-100 pb-3">
              <div className="flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-base font-bold text-slate-900">
                  <KeyRound className="h-5 w-5 text-[#005596]" />
                  Security & Change Password
                </h2>
                {isPwVerified ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-800">
                    <Unlock className="h-3 w-3" />
                    Verified
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
                    <Lock className="h-3 w-3" />
                    Locked
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-slate-500">
                Verify your current password first to unlock the new password fields.
              </p>
            </div>

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

            {/* STEP 1: VERIFY CURRENT PASSWORD */}
            {!isPwVerified ? (
              <form onSubmit={handleVerifyCurrentPassword} className="space-y-4">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-700">Current Password</label>
                  <div className="relative">
                    <input
                      type={showOldPw ? 'text' : 'password'}
                      value={oldPassword}
                      onChange={(e) => {
                        setOldPassword(e.target.value);
                        setPwError('');
                      }}
                      placeholder="Enter your current password"
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

                <button
                  type="submit"
                  disabled={verifyPending}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#005596] px-4 py-2 text-xs font-bold text-white shadow-sm transition-colors hover:bg-[#003A66] disabled:opacity-50"
                >
                  <Lock className="h-4 w-4" />
                  {verifyPending ? 'Verifying Current Password…' : 'Verify Current Password'}
                </button>
              </form>
            ) : (
              /* STEP 2: ENTER NEW PASSWORD & CONFIRMATION */
              <form onSubmit={handlePasswordSubmit} className="space-y-4">
                <div className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-xs">
                  <span className="font-semibold text-emerald-900">Current Password Verified</span>
                  <button
                    type="button"
                    onClick={() => {
                      setIsPwVerified(false);
                      setOldPassword('');
                      setNewPassword('');
                      setConfirmPassword('');
                      setPwSuccess('');
                      setPwError('');
                    }}
                    className="font-bold text-emerald-800 hover:underline"
                  >
                    Change Password Choice
                  </button>
                </div>

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

                <button
                  type="submit"
                  disabled={pwPending}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#005596] px-4 py-2.5 text-xs font-bold text-white shadow-sm transition-colors hover:bg-[#003A66] disabled:opacity-50"
                >
                  <KeyRound className="h-4 w-4" />
                  {pwPending ? 'Updating Password…' : 'Update Password'}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
