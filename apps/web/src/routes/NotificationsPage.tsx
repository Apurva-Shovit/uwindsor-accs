import React from 'react';
import { DeadlineSettings } from '../components/notifications/DeadlineSettings';
import { NotificationsPanel } from '../components/notifications/NotificationsPanel';
import { useAuth } from '../context/AuthContext';
import { isChairOrAdmin } from '../lib/roles';

/** The notification feed, reached from the bell and from the sidebar. */
export const NotificationsPage: React.FC = () => {
  const { user } = useAuth();

  return (
    <div className="space-y-6">

      {/* Managers can see the deadline on the panel below, but only chairs and
          admins get to move it. */}
      {isChairOrAdmin(user?.role) && <DeadlineSettings />}

      <NotificationsPanel />
    </div>
  );
};
