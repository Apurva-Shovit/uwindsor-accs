import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Users, LayoutDashboard, Database, Activity, ClipboardList, TrendingUp, RefreshCw, BookOpen, FileText, ChevronDown, Fish } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useSidebar } from '../../context/SidebarContext';

export const Sidebar: React.FC = () => {
  const { user } = useAuth();
  const { isSidebarOpen } = useSidebar();
  const isAdminOrChair = ['super_admin', 'chair', 'admin'].includes(user?.role || '');
  const isManagerPlus = ['super_admin', 'chair', 'admin', 'manager'].includes(user?.role || '');
  const [isFishMgmtOpen, setIsFishMgmtOpen] = useState(true);

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
        {isManagerPlus && (
          <NavLink
            to="/admin/dashboard"
            title="Dashboard"
            className={({ isActive }) => linkClass(isActive)}
          >
            <LayoutDashboard className={`h-5 w-5 ${isSidebarOpen ? 'mr-3' : ''}`} />
            {isSidebarOpen && <span>Dashboard</span>}
          </NavLink>
        )}

        {/* Fish Management Collapsible Group */}
        {isManagerPlus ? (
          <div className="space-y-1 py-1">
            <button
              onClick={() => setIsFishMgmtOpen((prev) => !prev)}
              className={`w-full flex items-center justify-between rounded-md text-sm font-bold text-slate-700 hover:bg-slate-100 transition-colors ${
                isSidebarOpen ? 'px-3 py-2' : 'p-2 justify-center'
              }`}
              title="Fish Management"
            >
              <div className="flex items-center gap-2">
                <Fish className={`h-5 w-5 text-[#005596] ${isSidebarOpen ? 'mr-1' : ''}`} />
                {isSidebarOpen && <span>Fish Management</span>}
              </div>
              {isSidebarOpen && (
                <ChevronDown
                  className={`h-4 w-4 text-slate-400 transition-transform duration-200 ${
                    isFishMgmtOpen ? 'transform rotate-180' : ''
                  }`}
                />
              )}
            </button>

            {isFishMgmtOpen && (
              <div className={`space-y-1 ${isSidebarOpen ? 'pl-2 border-l-2 border-slate-200 ml-3' : ''}`}>
                {/* 2. Daily Log Entry */}
                <NavLink
                  end
                  to="/staff/log-entry"
                  title="Daily Log Entry"
                  className={({ isActive }) => linkClass(isActive)}
                >
                  <ClipboardList className={`h-4 w-4 text-brandBlue ${isSidebarOpen ? 'mr-2.5' : ''}`} />
                  {isSidebarOpen && <span className="text-xs font-semibold">Daily Log Entry</span>}
                </NavLink>

                {/* 3. Population Census */}
                <NavLink
                  end
                  to="/staff/census"
                  title="Population Census"
                  className={({ isActive }) => linkClass(isActive)}
                >
                  <TrendingUp className={`h-4 w-4 text-emerald-600 ${isSidebarOpen ? 'mr-2.5' : ''}`} />
                  {isSidebarOpen && <span className="text-xs font-semibold">Population Census</span>}
                </NavLink>

                {/* 4. Tank Transfers */}
                <NavLink
                  end
                  to="/staff/transfers"
                  title="Tank Transfers"
                  className={({ isActive }) => linkClass(isActive)}
                >
                  <RefreshCw className={`h-4 w-4 text-indigo-600 ${isSidebarOpen ? 'mr-2.5' : ''}`} />
                  {isSidebarOpen && <span className="text-xs font-semibold">Tank Transfers</span>}
                </NavLink>

                {/* 5. Quarantine Monitor */}
                <NavLink
                  end
                  to="/staff/quarantine"
                  title="Quarantine Monitor"
                  className={({ isActive }) => linkClass(isActive)}
                >
                  <Activity className={`h-4 w-4 text-amber-600 ${isSidebarOpen ? 'mr-2.5' : ''}`} />
                  {isSidebarOpen && <span className="text-xs font-semibold">Quarantine Monitor</span>}
                </NavLink>
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Flat links for staff */}
            <NavLink
              end
              to="/staff/log-entry"
              title="Daily Log Entry"
              className={({ isActive }) => linkClass(isActive)}
            >
              <ClipboardList className={`h-5 w-5 text-brandBlue ${isSidebarOpen ? 'mr-3' : ''}`} />
              {isSidebarOpen && <span>Daily Log Entry</span>}
            </NavLink>

            <NavLink
              end
              to="/staff/census"
              title="Population Census"
              className={({ isActive }) => linkClass(isActive)}
            >
              <TrendingUp className={`h-5 w-5 text-emerald-600 ${isSidebarOpen ? 'mr-3' : ''}`} />
              {isSidebarOpen && <span>Population Census</span>}
            </NavLink>

            <NavLink
              end
              to="/staff/transfers"
              title="Tank Transfers"
              className={({ isActive }) => linkClass(isActive)}
            >
              <RefreshCw className={`h-5 w-5 text-indigo-600 ${isSidebarOpen ? 'mr-3' : ''}`} />
              {isSidebarOpen && <span>Tank Transfers</span>}
            </NavLink>

            <NavLink
              end
              to="/staff/quarantine"
              title="Quarantine Monitor"
              className={({ isActive }) => linkClass(isActive)}
            >
              <Activity className={`h-5 w-5 text-amber-600 ${isSidebarOpen ? 'mr-3' : ''}`} />
              {isSidebarOpen && <span>Quarantine Monitor</span>}
            </NavLink>
          </>
        )}

        {/* User Management (Chair / Admin / Super Admin only) */}
        {isAdminOrChair && (
          <NavLink
            to="/admin/users"
            title="User Management"
            className={({ isActive }) => linkClass(isActive)}
          >
            <Users className={`h-5 w-5 text-indigo-600 ${isSidebarOpen ? 'mr-3' : ''}`} />
            {isSidebarOpen && <span>User Management</span>}
          </NavLink>
        )}

        {/* 7. Tanks & Racks */}
        <NavLink
          end
          to={isManagerPlus ? '/admin/facility' : '/staff/tanks'}
          title="Tanks & Racks"
          className={({ isActive }) => linkClass(isActive)}
        >
          <Database className={`h-5 w-5 ${isSidebarOpen ? 'mr-3' : ''}`} />
          {isSidebarOpen && <span>Tanks & Racks</span>}
        </NavLink>

        {/* 8. Tank History Explorer */}
        <NavLink
          end
          to={isManagerPlus ? '/admin/tanks/history' : '/staff/tanks/history'}
          title="Tank History Explorer"
          className={({ isActive }) => linkClass(isActive)}
        >
          <ClipboardList className={`h-5 w-5 text-slate-500 ${isSidebarOpen ? 'mr-3' : ''}`} />
          {isSidebarOpen && <span>Tank History Explorer</span>}
        </NavLink>

        {/* 9. Research Projects */}
        <NavLink
          end
          to={isManagerPlus ? '/admin/projects' : '/staff/projects'}
          title="Research Projects"
          className={({ isActive }) => linkClass(isActive)}
        >
          <BookOpen className={`h-5 w-5 ${isSidebarOpen ? 'mr-3' : ''}`} />
          {isSidebarOpen && <span>Research Projects</span>}
        </NavLink>

        {/* 10. Reports */}
        {isManagerPlus && (
          <NavLink
            end
            to="/admin/reports"
            title="Reports"
            className={({ isActive }) => linkClass(isActive)}
          >
            <FileText className={`h-5 w-5 ${isSidebarOpen ? 'mr-3' : ''}`} />
            {isSidebarOpen && <span>Reports</span>}
          </NavLink>
        )}

        {/* 11. Audit Logs */}
        {isManagerPlus && (
          <NavLink
            end
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


