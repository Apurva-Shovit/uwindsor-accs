import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

export function RoleGuard({ allowedRoles, children }: { allowedRoles: string[]; children: React.ReactElement }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-surface">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brandBlue border-t-transparent"></div>
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;
  if (user.status !== 'active') return <Navigate to="/pending-approval" replace />;
  if (allowedRoles.length && user.role && !allowedRoles.includes(user.role)) {
    return <Navigate to="/login" replace />;
  }

  return children;
}
