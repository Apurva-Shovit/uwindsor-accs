import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { RoleGuard } from './components/guards/RoleGuard';
import { Login } from './routes/Login';
import { Signup } from './routes/Signup';
import { PendingApproval } from './routes/PendingApproval';
import { StaffLayout } from './routes/staff/StaffLayout';
import { AdminLayout } from './routes/admin/AdminLayout';
import { ErrorToast } from './components/ui/ErrorToast';
import { NativeBackHandler } from './components/native/NativeBackHandler';

import { SidebarProvider } from './context/SidebarContext';

export function App() {
  return (
    <AuthProvider>
      <ErrorToast />
      <SidebarProvider>
        <Router>
          <NativeBackHandler />
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/pending-approval" element={<PendingApproval />} />
            <Route
              path="/staff/*"
              element={
                <RoleGuard allowedRoles={['staff', 'manager', 'chair', 'admin', 'super_admin']}>
                  <StaffLayout />
                </RoleGuard>
              }
            />
            <Route
              path="/admin/*"
              element={
                <RoleGuard allowedRoles={['manager', 'chair', 'admin', 'super_admin']}>
                  <AdminLayout />
                </RoleGuard>
              }
            />
            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
        </Router>
      </SidebarProvider>
    </AuthProvider>
  );
}


export default App;
