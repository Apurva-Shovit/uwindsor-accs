import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Topbar } from '../../components/layout/Topbar';
import { Sidebar } from '../../components/layout/Sidebar';
import { ApprovalQueueTable } from '../../components/ApprovalQueueTable';
import { useAuth } from '../../context/AuthContext';

import { TanksView } from '../TanksView';
import { Dashboard } from './Dashboard';
import { Reports } from './Reports';
import { AuditLogs } from './AuditLogs';
import { ProjectOverviewPage } from './ProjectOverviewPage';
import { TankHistoryPage } from './TankHistoryPage';

export const AdminLayout: React.FC = () => {
  const { user } = useAuth();

  return (
    <div className="flex flex-col min-h-screen bg-surface">
      <Topbar />
      <div className="flex flex-1">
        <Sidebar />
        <main className="flex-1 p-6">
          <Routes>
            <Route path="facility" element={<TanksView isAdminMode={true} />} />
            <Route path="tanks" element={<TanksView isAdminMode={true} />} />
            <Route path="tanks/history" element={<TankHistoryPage />} />
            <Route
              path="/"
              element={<Navigate to="dashboard" replace />}
            />
            <Route path="approval-queue" element={<ApprovalQueueTable />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="projects" element={<ProjectOverviewPage />} />
            <Route path="reports" element={<Reports />} />
            <Route path="audit-logs" element={<AuditLogs />} />
            <Route path="*" element={<Navigate to="/admin" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
};


