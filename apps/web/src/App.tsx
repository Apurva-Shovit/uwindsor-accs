import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { RoleGuard } from './components/guards/RoleGuard';
import { AuthLanding } from './components/guards/AuthLanding';
import { ALL_ROLES, MANAGER_PLUS_ROLES } from './lib/roles';
import { Login } from './routes/Login';
import { Signup } from './routes/Signup';
import { PendingApproval } from './routes/PendingApproval';
import { StaffLayout } from './routes/staff/StaffLayout';
import { AdminLayout } from './routes/admin/AdminLayout';
import { ErrorToast } from './components/ui/ErrorToast';
import { NativeBackHandler } from './components/native/NativeBackHandler';
import { PushRegistrar } from './components/native/PushRegistrar';

import { SidebarProvider } from './context/SidebarContext';

export function App() {
  return (
    <AuthProvider>
      <ErrorToast />
      <SidebarProvider>
        <Router>
          <NativeBackHandler />
          <PushRegistrar />
          <Routes>
            {/* The bare site URL has to resolve against the session, not jump
                straight to the login form — a signed-in user landing here was
                being shown a login screen despite a valid session. */}
            <Route path="/" element={<AuthLanding />} />
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/pending-approval" element={<PendingApproval />} />
            <Route
              path="/staff/*"
              element={
                <RoleGuard allowedRoles={ALL_ROLES}>
                  <StaffLayout />
                </RoleGuard>
              }
            />
            <Route
              path="/admin/*"
              element={
                <RoleGuard allowedRoles={MANAGER_PLUS_ROLES}>
                  <AdminLayout />
                </RoleGuard>
              }
            />
            {/* Unknown paths resolve the same way, so a stale bookmark returns
                a signed-in user to their dashboard rather than to the login form. */}
            <Route path="*" element={<AuthLanding />} />
          </Routes>
        </Router>
      </SidebarProvider>
    </AuthProvider>
  );
}


export default App;
