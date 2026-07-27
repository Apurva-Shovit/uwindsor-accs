import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Topbar } from '../../components/layout/Topbar';
import { Sidebar } from '../../components/layout/Sidebar';
import { useAuth } from '../../context/AuthContext';

import { TanksView } from '../TanksView';
import { LogEntryPage } from './LogEntryPage';
import { ProjectDetailsPage } from './ProjectDetailsPage';
import { ProjectReportPage } from '../ProjectReportPage';
import { CensusPage } from './CensusPage';
import { TransferPage } from './TransferPage';
import { QuarantinePage } from './QuarantinePage';
import { OfficialFormsReportPage } from '../OfficialFormsReportPage';

export const StaffLayout: React.FC = () => {
  const { user } = useAuth();

  return (
    <div className="flex flex-col min-h-screen bg-surface">
      <Topbar />
      <div className="flex flex-1">
        <Sidebar />
        <main className="flex-1 p-6">
          <Routes>
            <Route path="/tanks" element={<TanksView />} />
            <Route path="/log-entry" element={<LogEntryPage />} />
            <Route path="/projects" element={<ProjectDetailsPage />} />
            <Route path="/projects/:id/report" element={<ProjectReportPage />} />
            <Route path="/sop-forms" element={<OfficialFormsReportPage />} />
            <Route path="/census" element={<CensusPage />} />
            <Route path="/transfers" element={<TransferPage />} />
            <Route path="/quarantine" element={<QuarantinePage />} />

            <Route
              path="/"
              element={
                <div className="space-y-6">
                  <h1 className="text-2xl font-bold text-textPrimary">Staff Workspace Dashboard</h1>
                  <div className="rounded-lg border border-border bg-white p-6 shadow-sm space-y-2">
                    <p className="text-sm font-medium text-textPrimary">Welcome back, {user?.first_name}!</p>
                    <p className="text-xs text-textSecondary">
                      Assigned Tanks: {user?.assigned_tank_ids?.length ? user.assigned_tank_ids.join(', ') : 'None assigned yet'}
                    </p>
                  </div>
                </div>
              }
            />
            <Route path="*" element={<Navigate to="/staff" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
};

