import React from 'react';
import { useAuth } from '../../context/AuthContext';
import { useSidebar } from '../../context/SidebarContext';
import { LogOut, Shield, User as UserIcon, Menu } from 'lucide-react';

export const Topbar: React.FC = () => {
  const { user, logout } = useAuth();
  const { toggleSidebar } = useSidebar();

  return (
    <header className="flex h-16 w-full items-center justify-between border-b border-border bg-white px-6 shadow-sm">
      <div className="flex items-center space-x-3">
        <button
          onClick={toggleSidebar}
          className="p-2 text-slate-600 hover:text-brandBlue hover:bg-slate-100 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-brandBlue/20"
          title="Toggle Navigation Menu"
          aria-label="Toggle Sidebar Menu"
        >
          <Menu className="h-5 w-5" />
        </button>
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brandBlue text-white font-bold">
          AC
        </div>
        <span className="text-lg font-semibold text-textPrimary">ACare Aquatic System</span>
      </div>


      <div className="flex items-center space-x-4">
        {user && (
          <div className="flex items-center space-x-3">
            <span className="inline-flex items-center rounded-full bg-brandBlueTint px-3 py-1 text-xs font-medium text-brandBlueDark">
              <Shield className="mr-1 h-3 w-3" />
              {user.role}
            </span>
            <div className="flex items-center text-sm font-medium text-textPrimary">
              <UserIcon className="mr-1.5 h-4 w-4 text-brandGrey" />
              {user.first_name} {user.last_name}
            </div>
            <button
              onClick={logout}
              className="inline-flex items-center rounded-md p-1.5 text-brandGrey hover:bg-surface hover:text-danger"
              title="Logout"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </header>
  );
};
