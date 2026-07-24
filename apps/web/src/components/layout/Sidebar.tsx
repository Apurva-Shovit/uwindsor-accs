import React from 'react';
import { NavLink } from 'react-router-dom';
import { Users, LayoutDashboard, Database, Activity, ClipboardList, TrendingUp, RefreshCw, BookOpen, FileText } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

export const Sidebar: React.FC = () => {
  const { user } = useAuth();
  const isAdminOrChair = ['super_admin', 'chair', 'admin'].includes(user?.role || '');

  return (
    <aside className="w-64 border-r border-border bg-white p-4">
      <nav className="space-y-1"> 
        {isAdminOrChair && (
          <>
            <NavLink
              to="/admin/approval-queue"
              className={({ isActive }) =>
                `flex items-center rounded-md px-3 py-2 text-sm font-medium transition-colors ${isActive
                  ? 'bg-brandBlueTint text-brandBlueDark'
                  : 'text-textSecondary hover:bg-surface hover:text-textPrimary'
                }`
              }
            >
              <Users className="mr-3 h-5 w-5" />
              Approval Queue
            </NavLink>
            <NavLink
              to="/admin/dashboard"
              className={({ isActive }) =>
                `flex items-center rounded-md px-3 py-2 text-sm font-medium transition-colors ${isActive
                  ? 'bg-brandBlueTint text-brandBlueDark'
                  : 'text-textSecondary hover:bg-surface hover:text-textPrimary'
                }`
              }
            >
              <LayoutDashboard className="mr-3 h-5 w-5" />
              Dashboard
            </NavLink>
            <NavLink
              to="/admin/reports"
              className={({ isActive }) =>
                `flex items-center rounded-md px-3 py-2 text-sm font-medium transition-colors ${isActive
                  ? 'bg-brandBlueTint text-brandBlueDark'
                  : 'text-textSecondary hover:bg-surface hover:text-textPrimary'
                }`
              }
            >
              <FileText className="mr-3 h-5 w-5" />
              Reports
            </NavLink>
            <NavLink
              to="/admin/audit-logs"
              className={({ isActive }) =>
                `flex items-center rounded-md px-3 py-2 text-sm font-medium transition-colors ${isActive
                  ? 'bg-brandBlueTint text-brandBlueDark'
                  : 'text-textSecondary hover:bg-surface hover:text-textPrimary'
                }`
              }
            >
              <Activity className="mr-3 h-5 w-5" />
              Audit Logs
            </NavLink>
          </>
        )}

        <NavLink
          to={isAdminOrChair ? '/admin/facility' : '/staff/tanks'}
          className={({ isActive }) =>
            `flex items-center rounded-md px-3 py-2 text-sm font-medium transition-colors ${isActive
              ? 'bg-brandBlueTint text-brandBlueDark'
              : 'text-textSecondary hover:bg-surface hover:text-textPrimary'
            }`
          }
        >
          <Database className="mr-3 h-5 w-5" />
          Tanks & Racks
        </NavLink>

        <NavLink
          to={isAdminOrChair ? '/admin/tanks/history' : '/staff/tanks/history'}
          className={({ isActive }) =>
            `flex items-center rounded-md px-3 py-2 text-sm font-medium transition-colors ${isActive
              ? 'bg-brandBlueTint text-brandBlueDark'
              : 'text-textSecondary hover:bg-surface hover:text-textPrimary'
            }`
          }
        >
          <ClipboardList className="mr-3 h-5 w-5" />
          Tank History Explorer
        </NavLink>


        <NavLink
          to="/staff/projects"
          className={({ isActive }) =>
            `flex items-center rounded-md px-3 py-2 text-sm font-medium transition-colors ${isActive
              ? 'bg-brandBlueTint text-brandBlueDark'
              : 'text-textSecondary hover:bg-surface hover:text-textPrimary'
            }`
          }
        >
          <BookOpen className="mr-3 h-5 w-5" />
          Research Projects
        </NavLink>

        <NavLink
          to="/staff/log-entry"
          className={({ isActive }) =>
            `flex items-center rounded-md px-3 py-2 text-sm font-medium transition-colors ${isActive
              ? 'bg-brandBlueTint text-brandBlueDark'
              : 'text-textSecondary hover:bg-surface hover:text-textPrimary'
            }`
          }
        >
          <ClipboardList className="mr-3 h-5 w-5" />
          Daily Log Entry
        </NavLink>

        <NavLink
          to="/staff/census"
          className={({ isActive }) =>
            `flex items-center rounded-md px-3 py-2 text-sm font-medium transition-colors ${isActive
              ? 'bg-brandBlueTint text-brandBlueDark'
              : 'text-textSecondary hover:bg-surface hover:text-textPrimary'
            }`
          }
        >
          <TrendingUp className="mr-3 h-5 w-5" />
          Population Census
        </NavLink>

        <NavLink
          to="/staff/transfers"
          className={({ isActive }) =>
            `flex items-center rounded-md px-3 py-2 text-sm font-medium transition-colors ${isActive
              ? 'bg-brandBlueTint text-brandBlueDark'
              : 'text-textSecondary hover:bg-surface hover:text-textPrimary'
            }`
          }
        >
          <RefreshCw className="mr-3 h-5 w-5" />
          Tank Transfers
        </NavLink>

        <NavLink
          to="/staff/quarantine"
          className={({ isActive }) =>
            `flex items-center rounded-md px-3 py-2 text-sm font-medium transition-colors ${isActive
              ? 'bg-brandBlueTint text-brandBlueDark'
              : 'text-textSecondary hover:bg-surface hover:text-textPrimary'
            }`
          }
        >
          <Activity className="mr-3 h-5 w-5 text-amber-600" />
          Quarantine Monitor
        </NavLink>


      </nav>
    </aside>
  );
};
