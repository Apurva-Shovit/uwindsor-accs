import React from 'react';
import { DeadlineSettings } from '../components/notifications/DeadlineSettings';
import { NotificationsPanel } from '../components/notifications/NotificationsPanel';
import { useAuth } from '../context/AuthContext';
import { isChairOrAdmin, isManagerPlus } from '../lib/roles';

/** The notification feed, reached from the bell and from the sidebar. */
export const NotificationsPage: React.FC = () => {
  const { user } = useAuth();

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-200 pb-4">
        <h1 className="text-2xl font-bold text-[#005596]">Notifications</h1>
        <p className="mt-1 text-sm text-slate-500">
          {isManagerPlus(user?.role)
            ? 'Everything currently needing attention across the facility.'
            : 'Everything currently needing attention on the tanks you are assigned to.'}
        </p>
      </div>

      {/* Managers can see the deadline on the panel below, but only chairs and
          admins get to move it. */}
      {isChairOrAdmin(user?.role) && <DeadlineSettings />}

      <NotificationsPanel />
    </div>
  );
};
