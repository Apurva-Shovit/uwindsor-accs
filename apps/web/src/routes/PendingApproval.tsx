import React from 'react';
import { Clock, LogOut } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';

export const PendingApproval: React.FC = () => {
  const { logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4">
      <div className="w-full max-w-md rounded-xl bg-white p-8 shadow-md border border-border text-center space-y-6">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-yellow-100 text-warning">
          <Clock className="h-8 w-8" />
        </div>

        <div>
          <h1 className="text-2xl font-bold text-textPrimary">Account Pending Approval</h1>
          <p className="mt-2 text-sm text-textSecondary">
            Your access request has been submitted successfully and is awaiting review by a system administrator or chair.
          </p>
        </div>

        <div className="rounded-lg bg-surface p-4 text-xs text-textSecondary border border-border">
          Once your request is approved, you will be able to log in with your credentials.
        </div>

        <button
          onClick={handleLogout}
          className="inline-flex w-full items-center justify-center rounded-md border border-border bg-white py-2 text-sm font-medium text-textPrimary hover:bg-surface"
        >
          <LogOut className="mr-2 h-4 w-4 text-brandGrey" /> Back to Login / Logout
        </button>
      </div>
    </div>
  );
};
