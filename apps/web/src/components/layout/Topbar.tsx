import React from 'react';
import { useAuth } from '../../context/AuthContext';
import { useSidebar } from '../../context/SidebarContext';
import { LogOut, Shield, User as UserIcon, Menu } from 'lucide-react';
import { NotificationBell } from '../notifications/NotificationBell';

export const Topbar: React.FC = () => {
  const { user, logout } = useAuth();
  const { isSidebarOpen, toggleSidebar } = useSidebar();

  return (
    <header className="flex h-16 flex-shrink-0 z-40 w-full items-center justify-between border-b border-border bg-white px-4 lg:px-6 shadow-sm">
      <div className="flex min-w-0 items-center space-x-2 sm:space-x-3">
        <button
          onClick={toggleSidebar}
          aria-controls="app-sidebar"
          aria-expanded={isSidebarOpen}
          className="p-2 text-slate-600 hover:text-brandBlue hover:bg-slate-100 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-brandBlue/20"
          title="Toggle Navigation Menu"
          aria-label="Toggle Sidebar Menu"
        >
          <Menu className="h-5 w-5" />
        </button>
        <img
          src="/topBarWinLogo.jpeg"
          alt="University of Windsor Logo"
          className="h-10 w-auto flex-shrink-0 object-contain"
        />
        <span className="hidden truncate text-lg font-semibold text-textPrimary sm:inline">ACare Aquatic System</span>
        <span className="truncate text-base font-semibold text-textPrimary sm:hidden">ACare</span>
      </div>


      <div className="flex flex-shrink-0 items-center space-x-2 sm:space-x-4">
        {user && (
          <div className="flex items-center space-x-2 sm:space-x-3">
            <span className="hidden items-center rounded-full bg-brandBlueTint px-3 py-1 text-xs font-medium text-brandBlueDark md:inline-flex">
              <Shield className="mr-1 h-3 w-3" />
              {user.role}
            </span>
            <div className="hidden items-center text-sm font-medium text-textPrimary md:flex">
              <UserIcon className="mr-1.5 h-4 w-4 text-brandGrey" />
              {user.first_name} {user.last_name}
            </div>
            <NotificationBell />
            <button
              onClick={logout}
              className="inline-flex items-center rounded-md p-2 text-brandGrey hover:bg-surface hover:text-danger sm:p-1.5"
              title="Logout"
              aria-label="Logout"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </header>
  );
};
