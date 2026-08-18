import React, { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Users, LayoutDashboard, Database, Activity, ClipboardList, TrendingUp, RefreshCw, BookOpen, FileText, ChevronDown, Fish, Download, Bell } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useSidebar } from '../../context/SidebarContext';
import { useIsDesktop } from '../../hooks/useMediaQuery';
import { notificationsPathForRole, useNotificationFeed } from '../../lib/notifications';

export const Sidebar: React.FC = () => {
  const { user } = useAuth();
  const { isSidebarOpen, setIsSidebarOpen } = useSidebar();
  const isDesktop = useIsDesktop();
  const location = useLocation();
  const asideRef = useRef<HTMLElement>(null);
  const isManagerPlus = ['super_admin', 'chair', 'admin', 'manager'].includes(user?.role || '');
  const [isFishMgmtOpen, setIsFishMgmtOpen] = useState(true);
  const { data: notifications } = useNotificationFeed('all');
  const unreadCount = notifications?.unread_count ?? 0;

  const isDrawerOpen = !isDesktop && isSidebarOpen;
  const isDrawerShut = !isDesktop && !isSidebarOpen;
  // The mobile drawer is always full width, so labels always show there.
  // On desktop this is exactly isSidebarOpen, so desktop rendering is unchanged.
  const showLabels = isDesktop ? isSidebarOpen : true;

  // Close the drawer after navigating (mobile only).
  useEffect(() => {
    if (!isDesktop) setIsSidebarOpen(false);
  }, [location.pathname, isDesktop, setIsSidebarOpen]);

  // Escape closes the drawer.
  useEffect(() => {
    if (!isDrawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsSidebarOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isDrawerOpen, setIsSidebarOpen]);

  // Move focus into the drawer when it opens.
  useEffect(() => {
    if (isDrawerOpen) asideRef.current?.focus();
  }, [isDrawerOpen]);

  // Auto-close the sidebar when main screen or anywhere outside the sidebar is touched or clicked on non-desktop screens
  useEffect(() => {
    if (isDesktop || !isSidebarOpen) return;

    const handleOutsideTouchOrClick = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node | null;
      if (!target) return;

      // Ignore touches/clicks inside the sidebar itself
      if (asideRef.current && asideRef.current.contains(target)) {
        return;
      }

      // Ignore touches/clicks on the sidebar toggle hamburger button
      const toggleBtn = document.querySelector('[aria-controls="app-sidebar"]');
      if (toggleBtn && toggleBtn.contains(target)) {
        return;
      }

      // Any touch or click on the main screen or outside sidebar auto-closes the sidebar
      setIsSidebarOpen(false);
    };

    document.addEventListener('touchstart', handleOutsideTouchOrClick, { passive: true });
    document.addEventListener('mousedown', handleOutsideTouchOrClick);

    return () => {
      document.removeEventListener('touchstart', handleOutsideTouchOrClick);
      document.removeEventListener('mousedown', handleOutsideTouchOrClick);
    };
  }, [isDesktop, isSidebarOpen, setIsSidebarOpen]);

  const linkClass = (isActive: boolean) =>
    `flex items-center rounded-md text-sm font-medium transition-colors ${
      showLabels ? 'px-3 py-2' : 'p-2 justify-center'
    } ${
      isActive
        ? 'bg-brandBlueTint text-brandBlueDark'
        : 'text-textSecondary hover:bg-surface hover:text-textPrimary'
    }`;

  const asideClass = isDesktop
    ? `border-r border-border bg-white transition-all duration-300 ease-in-out h-full overflow-y-auto flex-shrink-0 ${
        isSidebarOpen ? 'w-64 p-4' : 'w-16 p-2'
      }`
    : `fixed left-0 top-16 bottom-0 z-40 w-64 p-4 border-r border-border bg-white overflow-y-auto overscroll-contain shadow-xl transition-transform duration-300 ease-in-out ${
        isSidebarOpen ? 'translate-x-0' : '-translate-x-full'
      }`;

  return (
    <>
      {isDrawerOpen && (
        <div
          data-sidebar-backdrop
          aria-hidden="true"
          onClick={() => setIsSidebarOpen(false)}
          onTouchStart={() => setIsSidebarOpen(false)}
          className="fixed inset-0 z-30 bg-black/40"
        />
      )}
    <aside
      id="app-sidebar"
      ref={asideRef}
      aria-label="Main navigation"
      tabIndex={isDesktop ? undefined : -1}
      inert={isDrawerShut}
      aria-hidden={isDrawerShut || undefined}
      className={asideClass}
    >
      {!isDesktop && (
        <div className="mb-3 flex items-center gap-3 border-b border-border pb-3">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-brandBlueTint text-sm font-bold text-brandBlueDark">
            {`${user?.first_name?.[0] ?? ''}${user?.last_name?.[0] ?? ''}`}
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-textPrimary">
              {user?.first_name} {user?.last_name}
            </div>
            <div className="truncate text-xs capitalize text-textSecondary">
              {user?.role?.replace(/_/g, ' ')}
            </div>
          </div>
        </div>
      )}
      <nav className="space-y-1">
        {/* 1. Dashboard */}
        {isManagerPlus && (
          <NavLink
            to="/admin/dashboard"
            title="Dashboard"
            className={({ isActive }) => linkClass(isActive)}
          >
            <LayoutDashboard className={`h-5 w-5 ${showLabels ? 'mr-3' : ''}`} />
            {showLabels && <span>Dashboard</span>}
          </NavLink>
        )}

        {/* Notifications */}
        <NavLink
          end
          to={notificationsPathForRole(user?.role)}
          title="Notifications"
          className={({ isActive }) => linkClass(isActive)}
        >
          <span className="relative flex-shrink-0">
            <Bell className={`h-5 w-5 text-amber-600 ${showLabels ? 'mr-3' : ''}`} />
            {unreadCount > 0 && !showLabels && (
              <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full border border-white bg-red-500" />
            )}
          </span>
          {showLabels && (
            <>
              <span>Notifications</span>
              {unreadCount > 0 && (
                <span className="ml-auto rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700">
                  {unreadCount}
                </span>
              )}
            </>
          )}
        </NavLink>

        {/* Fish Management Collapsible Group */}
        {isManagerPlus ? (
          <div className="space-y-1 py-1">
            <button
              onClick={() => setIsFishMgmtOpen((prev) => !prev)}
              className={`w-full flex items-center justify-between rounded-md text-sm font-bold text-slate-700 hover:bg-slate-100 transition-colors ${
                showLabels ? 'px-3 py-2' : 'p-2 justify-center'
              }`}
              title="Fish Management"
            >
              <div className="flex items-center gap-2">
                <Fish className={`h-5 w-5 text-[#005596] ${showLabels ? 'mr-1' : ''}`} />
                {showLabels && <span>Fish Management</span>}
              </div>
              {showLabels && (
                <ChevronDown
                  className={`h-4 w-4 text-slate-400 transition-transform duration-200 ${
                    isFishMgmtOpen ? 'transform rotate-180' : ''
                  }`}
                />
              )}
            </button>

            {isFishMgmtOpen && (
              <div className={`space-y-1 ${showLabels ? 'pl-2 border-l-2 border-slate-200 ml-3' : ''}`}>
                {/* 2. Daily Log Entry */}
                <NavLink
                  end
                  to="/staff/log-entry"
                  title="Daily Log Entry"
                  className={({ isActive }) => linkClass(isActive)}
                >
                  <ClipboardList className={`h-4 w-4 text-brandBlue ${showLabels ? 'mr-2.5' : ''}`} />
                  {showLabels && <span className="text-xs font-semibold">Daily Log Entry</span>}
                </NavLink>

                {/* 3. Population Census */}
                <NavLink
                  end
                  to="/staff/census"
                  title="Population Census"
                  className={({ isActive }) => linkClass(isActive)}
                >
                  <TrendingUp className={`h-4 w-4 text-emerald-600 ${showLabels ? 'mr-2.5' : ''}`} />
                  {showLabels && <span className="text-xs font-semibold">Population Census</span>}
                </NavLink>

                {/* 4. Tank Transfers */}
                <NavLink
                  end
                  to="/staff/transfers"
                  title="Tank Transfers"
                  className={({ isActive }) => linkClass(isActive)}
                >
                  <RefreshCw className={`h-4 w-4 text-indigo-600 ${showLabels ? 'mr-2.5' : ''}`} />
                  {showLabels && <span className="text-xs font-semibold">Tank Transfers</span>}
                </NavLink>

                {/* 5. Quarantine Monitor */}
                <NavLink
                  end
                  to="/staff/quarantine"
                  title="Quarantine Monitor"
                  className={({ isActive }) => linkClass(isActive)}
                >
                  <Activity className={`h-4 w-4 text-amber-600 ${showLabels ? 'mr-2.5' : ''}`} />
                  {showLabels && <span className="text-xs font-semibold">Quarantine Monitor</span>}
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
              <ClipboardList className={`h-5 w-5 text-brandBlue ${showLabels ? 'mr-3' : ''}`} />
              {showLabels && <span>Daily Log Entry</span>}
            </NavLink>

            <NavLink
              end
              to="/staff/census"
              title="Population Census"
              className={({ isActive }) => linkClass(isActive)}
            >
              <TrendingUp className={`h-5 w-5 text-emerald-600 ${showLabels ? 'mr-3' : ''}`} />
              {showLabels && <span>Population Census</span>}
            </NavLink>

            <NavLink
              end
              to="/staff/transfers"
              title="Tank Transfers"
              className={({ isActive }) => linkClass(isActive)}
            >
              <RefreshCw className={`h-5 w-5 text-indigo-600 ${showLabels ? 'mr-3' : ''}`} />
              {showLabels && <span>Tank Transfers</span>}
            </NavLink>

            <NavLink
              end
              to="/staff/quarantine"
              title="Quarantine Monitor"
              className={({ isActive }) => linkClass(isActive)}
            >
              <Activity className={`h-5 w-5 text-amber-600 ${showLabels ? 'mr-3' : ''}`} />
              {showLabels && <span>Quarantine Monitor</span>}
            </NavLink>
          </>
        )}

        {/* User Management */}
        {isManagerPlus && (
          <NavLink
            end
            to="/admin/users"
            title="User Management"
            className={({ isActive }) => linkClass(isActive)}
          >
            <Users className={`h-5 w-5 text-indigo-600 ${showLabels ? 'mr-3' : ''}`} />
            {showLabels && <span>User Management</span>}
          </NavLink>
        )}

        {/* 7. Tanks & Racks */}
        <NavLink
          end
          to={isManagerPlus ? '/admin/facility' : '/staff/tanks'}
          title="Tanks & Racks"
          className={({ isActive }) => linkClass(isActive)}
        >
          <Database className={`h-5 w-5 ${showLabels ? 'mr-3' : ''}`} />
          {showLabels && <span>Tanks & Racks</span>}
        </NavLink>

        {/* 8. Tank History Explorer */}
        <NavLink
          end
          to={isManagerPlus ? '/admin/tanks/history' : '/staff/tanks/history'}
          title="Tank History Explorer"
          className={({ isActive }) => linkClass(isActive)}
        >
          <ClipboardList className={`h-5 w-5 text-slate-500 ${showLabels ? 'mr-3' : ''}`} />
          {showLabels && <span>Tank History Explorer</span>}
        </NavLink>

        {/* 9. Research Projects */}
        <NavLink
          end
          to={isManagerPlus ? '/admin/projects' : '/staff/projects'}
          title="Research Projects"
          className={({ isActive }) => linkClass(isActive)}
        >
          <BookOpen className={`h-5 w-5 ${showLabels ? 'mr-3' : ''}`} />
          {showLabels && <span>Research Projects</span>}
        </NavLink>

        {/* 10. Reports */}
        {isManagerPlus && (
          <NavLink
            end
            to="/admin/reports"
            title="Reports"
            className={({ isActive }) => linkClass(isActive)}
          >
            <FileText className={`h-5 w-5 ${showLabels ? 'mr-3' : ''}`} />
            {showLabels && <span>Reports</span>}
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
            <Activity className={`h-5 w-5 text-slate-600 ${showLabels ? 'mr-3' : ''}`} />
            {showLabels && <span>Audit Logs</span>}
          </NavLink>
        )}

        {/* 12. Data Export */}
        {isManagerPlus && (
          <NavLink
            end
            to="/admin/export"
            title="Data Export"
            className={({ isActive }) => linkClass(isActive)}
          >
            <Download className={`h-5 w-5 text-slate-600 ${showLabels ? 'mr-3' : ''}`} />
            {showLabels && <span>Data Export</span>}
          </NavLink>
        )}
      </nav>
    </aside>
    </>
  );
};


