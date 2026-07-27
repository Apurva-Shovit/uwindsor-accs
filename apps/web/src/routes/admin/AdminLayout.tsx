import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Topbar } from '../../components/layout/Topbar';
import { Sidebar } from '../../components/layout/Sidebar';
import { TanksView } from '../TanksView';
import { Dashboard } from './Dashboard';
import { Reports } from './Reports';
import { AuditLogs } from './AuditLogs';
import { ProjectOverviewPage } from './ProjectOverviewPage';
import { ProjectReportPage } from '../ProjectReportPage';
import { TankHistoryPage } from './TankHistoryPage';
import { UserManagement } from './UserManagement';



export const AdminLayout: React.FC = () => {



  return (
    <div className="flex flex-col h-screen overflow-hidden bg-surface">
      <Topbar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-y-auto p-6">
          <Routes>
            <Route path="facility" element={<TanksView isAdminMode={true} />} />
            <Route path="tanks" element={<TanksView isAdminMode={true} />} />
            <Route path="tanks/history" element={<TankHistoryPage />} />
            <Route
              path="/"
              element={<Navigate to="dashboard" replace />}
            />
            <Route path="users" element={<UserManagement />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="projects" element={<ProjectOverviewPage />} />
            <Route path="projects/:id/report" element={<ProjectReportPage />} />
            <Route path="reports" element={<Reports />} />
            <Route path="audit-logs" element={<AuditLogs />} />
            <Route path="*" element={<Navigate to="/admin" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
};


