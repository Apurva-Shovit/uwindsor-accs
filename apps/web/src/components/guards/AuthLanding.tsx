import { Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { homePathForRole } from '../../lib/roles';

/**
 * Sends a visitor to the right place for their auth state.
 *
 * Used for `/` and for unmatched paths, both of which previously redirected to
 * the login form unconditionally — so a signed-in user opening the bare site
 * URL was shown a login form despite having a valid session.
 *
 * Waiting on `loading` matters: AuthContext resolves the session via /auth/me,
 * and redirecting before that settles would bounce every signed-in user to
 * /login on a cold load.
 */
export function AuthLanding() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-surface">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brandBlue border-t-transparent"></div>
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;
  if (user.status !== 'active') return <Navigate to="/pending-approval" replace />;

  return <Navigate to={homePathForRole(user.role)} replace />;
}
