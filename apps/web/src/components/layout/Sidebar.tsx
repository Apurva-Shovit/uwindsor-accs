import React from 'react';
import { NavLink } from 'react-router-dom';
import { Users, LayoutDashboard, Database, Activity, ClipboardList, TrendingUp, RefreshCw, BookOpen, FileText } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useSidebar } from '../../context/SidebarContext';

export const Sidebar: React.FC = () => {
  const { user } = useAuth();
  const { isSidebarOpen } = useSidebar();
  const isAdminOrChair = ['super_admin', 'chair', 'admin'].includes(user?.role || '');

  const linkClass = (isActive: boolean) =>
    `flex items-center rounded-md text-sm font-medium transition-colors ${
      isSidebarOpen ? 'px-3 py-2' : 'p-2 justify-center'
    } ${
      isActive
        ? 'bg-brandBlueTint text-brandBlueDark'
        : 'text-textSecondary hover:bg-surface hover:text-textPrimary'
    }`;

  return (
    <aside
      className={`border-r border-border bg-white transition-all duration-300 ease-in-out ${
        isSidebarOpen ? 'w-64 p-4' : 'w-16 p-2'
      }`}
    >
      <nav className="space-y-1">
        {/* 1. Dashboard */}
        {isAdminOrChair && (
          <NavLink
            to="/admin/dashboard"
            title="Dashboard"
            className={({ isActive }) => linkClass(isActive)}
          >
            <LayoutDashboard className={`h-5 w-5 ${isSidebarOpen ? 'mr-3' : ''}`} />
            {isSidebarOpen && <span>Dashboard</span>}
          </NavLink>
        )}

        {/* 2. Daily Log Entry */}
        <NavLink
          to="/staff/log-entry"
          title="Daily Log Entry"
          className={({ isActive }) => linkClass(isActive)}
        >
          <ClipboardList className={`h-5 w-5 text-brandBlue ${isSidebarOpen ? 'mr-3' : ''}`} />
          {isSidebarOpen && <span>Daily Log Entry</span>}
        </NavLink>

        {/* 3. Population Census */}
        <NavLink
          to="/staff/census"
          title="Population Census"
          className={({ isActive }) => linkClass(isActive)}
        >
          <TrendingUp className={`h-5 w-5 text-emerald-600 ${isSidebarOpen ? 'mr-3' : ''}`} />
          {isSidebarOpen && <span>Population Census</span>}
        </NavLink>

        {/* 4. Tank Transfers */}
        <NavLink
          to="/staff/transfers"
          title="Tank Transfers"
          className={({ isActive }) => linkClass(isActive)}
        >
          <RefreshCw className={`h-5 w-5 text-indigo-600 ${isSidebarOpen ? 'mr-3' : ''}`} />
          {isSidebarOpen && <span>Tank Transfers</span>}
        </NavLink>

        {/* 5. Quarantine Monitor */}
        <NavLink
          to="/staff/quarantine"
          title="Quarantine Monitor"
          className={({ isActive }) => linkClass(isActive)}
        >
          <Activity className={`h-5 w-5 text-amber-600 ${isSidebarOpen ? 'mr-3' : ''}`} />
          {isSidebarOpen && <span>Quarantine Monitor</span>}
        </NavLink>

        {/* 6. Approval Queue (Admin/Chair only) */}
        {isAdminOrChair && (
          <NavLink
            to="/admin/approval-queue"
            title="Approval Queue"
            className={({ isActive }) => linkClass(isActive)}
          >
            <Users className={`h-5 w-5 text-sky-600 ${isSidebarOpen ? 'mr-3' : ''}`} />
            {isSidebarOpen && <span>Approval Queue</span>}
          </NavLink>
        )}

        {/* 7. Tanks & Racks */}
        <NavLink
          to={isAdminOrChair ? '/admin/facility' : '/staff/tanks'}
          title="Tanks & Racks"
          className={({ isActive }) => linkClass(isActive)}
        >
          <Database className={`h-5 w-5 ${isSidebarOpen ? 'mr-3' : ''}`} />
          {isSidebarOpen && <span>Tanks & Racks</span>}
        </NavLink>

        {/* 8. Tank History Explorer */}
        <NavLink
          to={isAdminOrChair ? '/admin/tanks/history' : '/staff/tanks/history'}
          title="Tank History Explorer"
          className={({ isActive }) => linkClass(isActive)}
        >
          <ClipboardList className={`h-5 w-5 text-slate-500 ${isSidebarOpen ? 'mr-3' : ''}`} />
          {isSidebarOpen && <span>Tank History Explorer</span>}
        </NavLink>

        {/* 9. Research Projects */}
        <NavLink
          to={isAdminOrChair ? '/admin/projects' : '/staff/projects'}
          title="Research Projects"
          className={({ isActive }) => linkClass(isActive)}
        >
          <BookOpen className={`h-5 w-5 ${isSidebarOpen ? 'mr-3' : ''}`} />
          {isSidebarOpen && <span>Research Projects</span>}
        </NavLink>

        {/* 10. Reports (Admin/Chair only) */}
        {isAdminOrChair && (
          <NavLink
            to="/admin/reports"
            title="Reports"
            className={({ isActive }) => linkClass(isActive)}
          >
            <FileText className={`h-5 w-5 ${isSidebarOpen ? 'mr-3' : ''}`} />
            {isSidebarOpen && <span>Reports</span>}
          </NavLink>
        )}

        {/* 11. Audit Logs (Admin/Chair only) */}
        {isAdminOrChair && (
          <NavLink
            to="/admin/audit-logs"
            title="Audit Logs"
            className={({ isActive }) => linkClass(isActive)}
          >
            <Activity className={`h-5 w-5 text-slate-600 ${isSidebarOpen ? 'mr-3' : ''}`} />
            {isSidebarOpen && <span>Audit Logs</span>}
          </NavLink>
        )}
      </nav>
    </aside>
  );
};


