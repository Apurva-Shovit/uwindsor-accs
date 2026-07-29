import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Topbar } from '../../components/layout/Topbar';
import { Sidebar } from '../../components/layout/Sidebar';

import { TanksView } from '../TanksView';
import { LogEntryPage } from './LogEntryPage';
import { ProjectDetailsPage } from './ProjectDetailsPage';
import { ProjectReportPage } from '../ProjectReportPage';
import { CensusPage } from './CensusPage';
import { TransferPage } from './TransferPage';
import { QuarantinePage } from './QuarantinePage';
import { TankHistoryPage } from '../admin/TankHistoryPage';

export const StaffLayout: React.FC = () => {
  return (
    <div className="flex flex-col h-screen overflow-hidden bg-surface">
      <Topbar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-y-auto p-6">
          <Routes>
            <Route path="tanks" element={<TanksView />} />
            <Route path="tanks/history" element={<TankHistoryPage />} />
            <Route path="log-entry" element={<LogEntryPage />} />
            <Route path="projects" element={<ProjectDetailsPage />} />
            <Route path="projects/:id/report" element={<ProjectReportPage />} />
            <Route path="census" element={<CensusPage />} />
            <Route path="transfers" element={<TransferPage />} />
            <Route path="quarantine" element={<QuarantinePage />} />

            <Route path="/" element={<Navigate to="tanks" replace />} />
            <Route path="dashboard" element={<Navigate to="tanks" replace />} />
            <Route path="*" element={<Navigate to="tanks" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
};

